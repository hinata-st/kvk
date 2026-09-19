import { useMemo, useState } from 'react';

import { dayKey, formatSpan, gameSeconds, scenarioSeries, shiftDay, type Grain } from '../../core/aggregate';
import { scenarioLaunchUrl } from '../../core/launch';
import { rankForScore } from '../../core/rank';
import type { Run } from '../../core/types';
import { useStore } from '../../app/store';
import type { EChartsOption, SeriesOption } from 'echarts';

import { EChart } from '../EChart';
import { BenchmarkTable } from '../BenchmarkTable';
import { CATEGORY_PALETTE, CategoryCompareChart } from '../CategoryCompareChart';
import { seriesDataFor, tooltipFor, xAxisFor } from '../scoreAxis';

const GRAIN_LABELS: { value: Grain; label: string }[] = [
  { value: 'day', label: '按天' },
  { value: 'session', label: '按次训练' },
  { value: 'run', label: '按局' },
];

function ScenarioChart({
  scenario,
  runs,
  grain,
  rankMaxes,
  targetRank,
  cachedBest,
}: {
  scenario: string;
  runs: readonly Run[];
  grain: Grain;
  rankMaxes: number[];
  targetRank: number;
  /** TopScores.sav 里的个人最高分。本地记录追不上它时，画一条虚线提醒别当真看本地那条 */
  cachedBest?: number;
}) {
  const option = useMemo<EChartsOption>(() => {
    const mine = runs.filter((r) => r.scenario === scenario);
    const points = scenarioSeries(mine, grain);
    const target = rankMaxes[targetRank - 1];
    const series: SeriesOption[] = [
      {
        name: scenario,
        type: 'line',
        showSymbol: grain !== 'run',
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
        data: seriesDataFor(grain, points, () => targetValue),
        showSymbol: false,
        lineStyle: { type: 'dashed', width: 1, color: '#f59e0b' },
        itemStyle: { color: '#f59e0b' },
      });
    }
    if (cachedBest !== undefined && cachedBest > 0) {
      const cachedValue = cachedBest;
      series.push({
        name: `存档 PB ${cachedBest}`,
        type: 'line',
        data: seriesDataFor(grain, points, () => cachedValue),
        showSymbol: false,
        lineStyle: { type: 'dotted', width: 1, color: '#38bdf8' },
        itemStyle: { color: '#38bdf8' },
      });
    }
    return {
      grid: { left: 56, right: 16, top: 28, bottom: 28 },
      tooltip: tooltipFor(grain, points),
      // 按局 / 按次训练是序号轴，按天是日期轴；点密的时候都别把标签叠在一起
      xAxis: xAxisFor(grain, points),
      yAxis: { type: 'value', scale: true },
      series,
    };
  }, [scenario, runs, grain, rankMaxes, targetRank, cachedBest]);

  return <EChart option={option} height={220} />;
}

export function HomePage({ onOpenScenario }: { onOpenScenario: (scenario: string) => void }) {
  const {
    runs,
    bestByScenario,
    topScores,
    activeBenchmark,
    progression,
    settings,
    subcategoryLabel,
    plan,
    addPlanEntry,
    removePlanEntry,
    advanceSchedule,
  } = useStore();
  const [grain, setGrain] = useState<Grain>('day');
  const today = dayKey(new Date());

  const scenarioIndex = useMemo(() => {
    const map = new Map<string, { subcategory: string; rankMaxes: number[] }>();
    for (const sub of activeBenchmark?.subcategories ?? []) {
      for (const scenario of sub.scenarios) {
        map.set(scenario.name, { subcategory: sub.name, rankMaxes: scenario.rankMaxes });
      }
    }
    return map;
  }, [activeBenchmark]);

  const todayRuns = useMemo(() => runs.filter((r) => dayKey(r.startedAt) === today), [runs, today]);
  const todayPlan = useMemo(() => plan.filter((p) => p.day === today), [plan, today]);
  const tomorrow = shiftDay(today, 1);
  const tomorrowPlan = useMemo(() => plan.filter((p) => p.day === tomorrow), [plan, tomorrow]);

  /** 今天排了的场景，去重且只留属于当前 benchmark 的（换过 benchmark 时旧计划还在库里） */
  const plannedScenarios = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const entry of todayPlan) {
      if (seen.has(entry.scenario) || !scenarioIndex.has(entry.scenario)) continue;
      seen.add(entry.scenario);
      names.push(entry.scenario);
    }
    return names;
  }, [todayPlan, scenarioIndex]);

  /** 今天每个场景的最高分 */
  const todayBest = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of todayRuns) {
      const current = map.get(run.scenario);
      if (current === undefined || run.score > current) map.set(run.scenario, run.score);
    }
    return map;
  }, [todayRuns]);

  const quota = settings.quotaRuns;
  const quotaPct = quota > 0 ? Math.min(100, Math.round((todayRuns.length / quota) * 100)) : 0;

  /** 今天打开游戏的时间：每段训练从第一局算到最后一局，含中间没在打的间隔 */
  const todayGameSec = useMemo(() => gameSeconds(todayRuns), [todayRuns]);

  /** 今天的计划里已经有哪些场景，用来把「加到今天」变成「已加入」 */
  const plannedToday = useMemo(() => new Set(todayPlan.map((entry) => entry.scenario)), [todayPlan]);

  if (!activeBenchmark || !progression) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-5 text-slate-300">
        <p className="font-medium text-slate-100">还没选 benchmark</p>
        <p className="mt-1 text-sm">
          去「设置」页选一个当前要追的 benchmark，并设好目标等级，这里就会出现今天的候选池。
        </p>
      </div>
    );
  }

  const currentCategory = progression.current;
  const rankName = (rank: number) => activeBenchmark.ranks[rank]?.name ?? `等级 ${rank}`;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-100">今天</h2>
          <div className="text-sm text-slate-400">
            目标等级 <span className="font-medium text-amber-400">{rankName(settings.targetRank)}</span>
            {currentCategory ? (
              <>
                {' · '}当前大组{' '}
                <span className="font-medium text-sky-400">{currentCategory.name}</span>
              </>
            ) : (
              <span className="text-emerald-400"> · 全部达标</span>
            )}
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-400">今日训练量</span>
            <span className="flex items-baseline gap-4">
              <span className="font-mono text-slate-200">
                {todayRuns.length} / {quota} 局
              </span>
              <span
                className="font-mono text-slate-400"
                title="从今天第一局开始算到最后一局结束，含中间没在打的间隔；间隔超过 30 分钟算两次训练"
              >
                游戏 {todayGameSec > 0 ? formatSpan(todayGameSec) : '—'}
              </span>
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${quotaPct >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
              style={{ width: `${quotaPct}%` }}
            />
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-medium text-slate-400">
            今天的计划
            {todayPlan.length === 0 && <span className="ml-2 text-slate-500">（还没挑，从下面的候选池里加）</span>}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {todayPlan.map((entry) => {
              const meta = scenarioIndex.get(entry.scenario);
              const best = todayBest.get(entry.scenario) ?? 0;
              const rank = meta ? rankForScore(best, meta.rankMaxes) : 0;
              const cleared = rank >= settings.targetRank;
              const target = meta?.rankMaxes[settings.targetRank - 1];
              return (
                <li
                  key={`${entry.day}-${entry.scenario}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-700 bg-slate-900/40 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className={cleared ? 'text-emerald-400' : 'text-slate-500'}>
                      {cleared ? '✓' : '○'}
                    </span>
                    <button
                      type="button"
                      className="text-left font-medium text-slate-100 hover:text-sky-400"
                      onClick={() => onOpenScenario(entry.scenario)}
                    >
                      {entry.scenario}
                    </button>
                    <a
                      href={scenarioLaunchUrl(entry.scenario)}
                      title={`用 Steam 打开 KovaaK's 并直接进到 ${entry.scenario}`}
                      className="rounded px-1 py-0.5 text-[11px] leading-none text-slate-500 transition hover:bg-sky-600/20 hover:text-sky-300"
                    >
                      ▶
                    </a>
                    <span className="text-xs text-slate-500">{subcategoryLabel(entry.subcategory)}</span>
                    {entry.auto === true && (
                      <span className="rounded bg-slate-700/70 px-1 text-[10px] text-slate-400">自动</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-slate-300">
                      今日最高 {best > 0 ? best : '—'}
                      {target !== undefined && !cleared && best > 0 && (
                        <span className="text-slate-500"> / 差 {Math.round((target - best) * 100) / 100}</span>
                      )}
                    </span>
                    {best > 0 && <span className="text-xs text-slate-400">{rankName(rank)}</span>}
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-rose-400"
                      onClick={() => void removePlanEntry(entry.day, entry.scenario)}
                    >
                      移除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-5 border-t border-slate-700/60 pt-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-slate-400">
              明天
              <span className="ml-2 text-slate-500">{tomorrow}</span>
            </h3>
            <button
              type="button"
              className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-400 transition hover:bg-slate-700"
              onClick={() => void advanceSchedule()}
            >
              重算
            </button>
          </div>
          {tomorrowPlan.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              {todayPlan.length === 0
                ? '今天先排一个，之后系统会按过关情况自动往后排。'
                : '还没有生成。今天有成绩之后（或者点一下「重算」）就会出来。'}
            </p>
          ) : (
            <>
              <ul className="mt-2 flex flex-wrap gap-2">
                {tomorrowPlan.map((entry) => (
                  <li
                    key={`${entry.day}-${entry.scenario}`}
                    className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/40 px-2.5 py-1 text-sm"
                  >
                    <button
                      type="button"
                      className="text-slate-100 hover:text-sky-400"
                      onClick={() => onOpenScenario(entry.scenario)}
                    >
                      {entry.scenario}
                    </button>
                    <span className="text-xs text-slate-500">{subcategoryLabel(entry.subcategory)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                没过关的留到明天，过了关的从候选池里补新的；今天的结果一变它就跟着变。
                想要哪一天固定下来，去「日历」页手动给它加一条，那天就不会再自动重排。
              </p>
            </>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-400">
            全部场景
            <span className="ml-2 text-slate-500">整个 benchmark 的分数和段位</span>
          </h3>
          {currentCategory ? (
            <span className="text-xs text-slate-500">
              当前训练目标{' '}
              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-medium text-sky-300">
                {currentCategory.name}
              </span>
              <span className="ml-2">候选 {progression.candidates.length} 个</span>
            </span>
          ) : (
            <span className="text-xs text-emerald-400">这个 benchmark 已经全部达标了</span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          实色条是你已经走完的段位，斜切的那一格是分数在下一段位里的位置（百分比同义）。左边的竖排是它的归属，右边按钮把它加进今天的计划。
        </p>
        <div className="mt-3">
          <BenchmarkTable
            categories={progression.categories}
            ranks={activeBenchmark.ranks}
            targetRank={settings.targetRank}
            currentCategory={currentCategory?.name ?? null}
            plannedToday={plannedToday}
            subcategoryLabel={subcategoryLabel}
            onOpenScenario={onOpenScenario}
            onAdd={(entry) =>
              void addPlanEntry({
                day: today,
                benchmarkId: activeBenchmark.benchmarkId,
                category: entry.category,
                subcategory: entry.subcategory,
                scenario: entry.scenario,
              })
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-slate-400">
            今天这些场景的曲线
            {todayPlan.length > 0 && (
              <span className="ml-2 text-slate-500">{plannedScenarios.length} 个（原始分数）</span>
            )}
          </h3>
          <div className="flex gap-1">
            {GRAIN_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`rounded px-2 py-1 text-xs transition ${
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

        {plannedScenarios.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            今天还没排计划。从上面的清单里加几个，这里就会出现它们的分数曲线。
          </p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {plannedScenarios.map((name) => {
              const meta = scenarioIndex.get(name);
              const runCount = runs.filter((r) => r.scenario === name).length;
              const best = bestByScenario.get(name) ?? 0;
              const cached = topScores.scores.get(name);
              const rank = meta ? rankForScore(best, meta.rankMaxes) : 0;
              const localMax = runs.reduce((max, r) => (r.scenario === name ? Math.max(max, r.score) : max), 0);
              return (
                <div key={name} className="rounded border border-slate-700 bg-slate-900/40 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <button
                      type="button"
                      className="truncate text-left text-sm font-medium text-slate-100 hover:text-sky-400"
                      onClick={() => onOpenScenario(name)}
                    >
                      {name}
                    </button>
                    <span className="shrink-0 text-xs text-slate-500">
                      {meta ? `${subcategoryLabel(meta.subcategory)} · ` : ''}PB {best} · {rankName(rank)}
                    </span>
                  </div>
                  {runCount === 0 ? (
                    <p className="mt-6 mb-6 text-center text-sm text-slate-600">
                      {cached !== undefined
                        ? `本地一局都没有，存档里的最高分是 ${cached}`
                        : '还没打过'}
                    </p>
                  ) : (
                    <ScenarioChart
                      scenario={name}
                      runs={runs}
                      grain={grain}
                      rankMaxes={meta?.rankMaxes ?? []}
                      targetRank={settings.targetRank}
                      cachedBest={cached !== undefined && cached > localMax ? cached : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-700 bg-slate-800/50 p-5">
        <h3 className="text-sm font-medium text-slate-400">所有大组对比</h3>
        <p className="mt-1 text-xs text-slate-500">
          各场景分数尺度差太多，没法画在同一根 Y 轴上。所以这里用的是「历史最高分 ÷ 该场景最高等级阈值」，
          再对组内场景取平均。只涨不跌，100% = 摸到最高等级。
        </p>
        <div className="mt-3">
          <CategoryCompareChart height={380} />
        </div>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {progression.categories.map((category, index) => (
            <li
              key={category.name}
              className="flex items-center justify-between rounded border border-slate-700 bg-slate-900/40 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] }}
                />
                <span className="text-slate-100">{category.name}</span>
              </span>
              <span className={category.cleared ? 'text-emerald-400' : 'text-amber-400'}>
                {category.cleared ? '已达标' : '未达标'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
