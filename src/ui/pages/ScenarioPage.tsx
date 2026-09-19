import { useMemo, useState } from 'react';

import { scenarioSeries, seriesChangePct, splitIntoSessions, type Grain } from '../../core/aggregate';
import { scenarioLaunchUrl } from '../../core/launch';
import { rankForScore, topThreshold } from '../../core/rank';
import { useStore } from '../../app/store';
import type { EChartsOption, SeriesOption } from 'echarts';

import { ChangeBadge } from '../ChangeBadge';
import { EChart } from '../EChart';
import { seriesDataFor, tooltipFor, xAxisFor } from '../scoreAxis';

const GRAIN_LABELS: { value: Grain; label: string }[] = [
  { value: 'run', label: '按局' },
  { value: 'session', label: '按次训练' },
  { value: 'day', label: '按天' },
];

const TABLE_LIMIT = 200;

export function ScenarioPage({ scenario }: { scenario: string }) {
  const { runs, activeBenchmark, settings, topScores } = useStore();
  const [grain, setGrain] = useState<Grain>('run');

  const mine = useMemo(() => runs.filter((r) => r.scenario === scenario), [runs, scenario]);

  const rankMaxes = useMemo(() => {
    for (const sub of activeBenchmark?.subcategories ?? []) {
      for (const s of sub.scenarios) if (s.name === scenario) return s.rankMaxes;
    }
    return [];
  }, [activeBenchmark, scenario]);

  /** 逐局文件里算得出来的最高分 */
  const localMax = useMemo(() => mine.reduce((max, r) => Math.max(max, r.score), 0), [mine]);
  /** TopScores.sav 里的个人最高分，可能比本地记录高很多 */
  const cached = topScores.scores.get(scenario);
  const best = Math.max(localMax, cached ?? 0);
  const rank = rankForScore(best, rankMaxes);
  const target = rankMaxes[settings.targetRank - 1];
  const rankName = (r: number) => activeBenchmark?.ranks[r]?.name ?? (r > 0 ? `等级 ${r}` : '未定级');

  const option = useMemo<EChartsOption>(() => {
    const points = scenarioSeries(mine, grain);
    const series: SeriesOption[] = [
      {
        name: '分数',
        type: 'line',
        showSymbol: true,
        symbolSize: grain === 'run' ? 4 : 6,
        data: seriesDataFor(grain, points, (p) => p.best),
        lineStyle: { width: 2 },
      },
    ];
    if (target !== undefined) {
      const targetValue = target;
      series.push({
        name: `目标 ${target}`,
        type: 'line',
        showSymbol: false,
        silent: true,
        data: seriesDataFor(grain, points, () => targetValue),
        lineStyle: { type: 'dashed', width: 1, color: '#f59e0b' },
        itemStyle: { color: '#f59e0b' },
      });
    }
    if (cached !== undefined && cached > localMax) {
      const cachedValue = cached;
      series.push({
        name: `存档 PB ${cached}`,
        type: 'line',
        showSymbol: false,
        silent: true,
        data: seriesDataFor(grain, points, () => cachedValue),
        lineStyle: { type: 'dotted', width: 1, color: '#38bdf8' },
        itemStyle: { color: '#38bdf8' },
      });
    }
    return {
      grid: { left: 64, right: 20, top: 32, bottom: 32 },
      legend: { top: 0, textStyle: { color: '#cbd5e1' } },
      tooltip: tooltipFor(grain, points),
      xAxis: xAxisFor(grain, points),
      yAxis: { type: 'value', scale: true },
      series,
    };
  }, [mine, grain, target, cached, localMax]);

  const sessions = useMemo(() => splitIntoSessions(mine), [mine]);
  const recent = useMemo(() => [...mine].reverse().slice(0, TABLE_LIMIT), [mine]);
  /** 曲线首尾变化。跟着粒度走：按局比的是第一局和最后一局，按天比的是第一天和最近一天 */
  const changePct = useMemo(() => seriesChangePct(scenarioSeries(mine, grain)), [mine, grain]);

  if (mine.length === 0) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-100">{scenario}</h2>
          <a
            href={scenarioLaunchUrl(scenario)}
            title={`用 Steam 打开 KovaaK's 并直接进到 ${scenario}`}
            className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 transition hover:border-sky-500 hover:text-sky-300"
          >
            ▶ 进游戏
          </a>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          stats 目录里一局都没有。
          {cached !== undefined
            ? `存档里的最高分是 ${cached}，等级 ${rankName(rankForScore(cached, rankMaxes))}。`
            : '存档里也没有它的记录，大概是真没打过。'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-100">{scenario}</h2>
            <ChangeBadge
              pct={changePct}
              title={`这条${grain === 'run' ? '按局' : grain === 'session' ? '按次训练' : '按天'}曲线首尾的变化`}
            />
            <a
              href={scenarioLaunchUrl(scenario)}
              title={`用 Steam 打开 KovaaK's 并直接进到 ${scenario}`}
              className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 transition hover:border-sky-500 hover:text-sky-300"
            >
              ▶ 进游戏
            </a>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {mine.length} 局 · {sessions.length} 次训练 · 净时长{' '}
            {(mine.reduce((s, r) => s + r.durationSec, 0) / 3600).toFixed(1)} 小时
          </p>
          {cached !== undefined && cached > localMax && (
            <p className="mt-1 text-xs text-sky-400">
              更早的成绩已经不在 stats 目录里了。存档（TopScores.sav）里的最高分是 {cached}，比本地记录高。
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {GRAIN_LABELS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded px-2.5 py-1 text-xs transition ${
                grain === option.value
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-700/60 text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setGrain(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          {
            label: cached !== undefined && cached > localMax ? '历史最高（存档）' : '历史最高',
            value: String(best),
          },
          {
            label: '当前等级',
            value: rankName(rank),
          },
          {
            label: `目标 ${rankName(settings.targetRank)}`,
            value: target === undefined ? '—' : best >= target ? '已达标' : `差 ${Math.round((target - best) * 100) / 100}`,
          },
          {
            label: '最高等级阈值',
            value: String(topThreshold(rankMaxes) ?? '—'),
          },
        ].map((card) => (
          <div key={card.label} className="rounded border border-slate-700 bg-slate-800/50 px-3 py-2">
            <div className="text-xs text-slate-500">{card.label}</div>
            <div className="mt-0.5 font-mono text-slate-100">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <EChart option={option} height={420} />
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
        <h3 className="text-sm font-medium text-slate-400">
          每一局{recent.length < mine.length && `（只显示最近 ${TABLE_LIMIT} 局）`}
        </h3>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-800 text-xs text-slate-500">
              <tr>
                <th className="py-1.5 pr-3 font-normal">时间</th>
                <th className="py-1.5 pr-3 font-normal">分数</th>
                <th className="py-1.5 pr-3 font-normal">等级</th>
                <th className="py-1.5 pr-3 font-normal">时长</th>
                <th className="py-1.5 pr-3 font-normal">cm/360</th>
                <th className="py-1.5 font-normal">分辨率</th>
              </tr>
            </thead>
            <tbody className="font-mono text-slate-300">
              {recent.map((run) => (
                <tr key={run.sourceFile} className="border-t border-slate-700/60">
                  <td className="py-1 pr-3">{new Date(run.startedAt).toLocaleString('zh-CN')}</td>
                  <td className="py-1 pr-3">{run.score}</td>
                  <td className="py-1 pr-3">{rankForScore(run.score, rankMaxes)}</td>
                  <td className="py-1 pr-3">{Math.round(run.durationSec)}s</td>
                  <td className="py-1 pr-3">{run.settings.cm360 ?? '—'}</td>
                  <td className="py-1">{run.settings.resolution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
