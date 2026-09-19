import { useMemo, useState } from 'react';

import { categorySeries } from '../core/aggregate';
import { topThreshold } from '../core/rank';
import { useStore } from '../app/store';
import type { EChartsOption, SeriesOption } from 'echarts';

import { EChart } from './EChart';

export const CATEGORY_PALETTE = [
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#facc15',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#f87171',
];

/**
 * 所有大组放在一张图里对比。
 *
 * Y 轴不是原始分数（不同场景的分数尺度差好几个数量级，没法同图），而是
 * 「截至当天的历史最高分 ÷ 该场景最高等级阈值」，再对组内场景取平均。
 * 所以是单调不减的累积 PB 曲线，100% 表示摸到最高等级。
 */
export function CategoryCompareChart({ height = 420 }: { height?: number }) {
  const { runs, activeBenchmark, progression, topScores } = useStore();
  const [withArchive, setWithArchive] = useState(true);

  const option = useMemo<EChartsOption | null>(() => {
    if (!activeBenchmark || !progression) return null;

    const topOf = (scenario: string) => {
      for (const sub of activeBenchmark.subcategories) {
        for (const s of sub.scenarios) if (s.name === scenario) return topThreshold(s.rankMaxes);
      }
      return null;
    };

    const series: SeriesOption[] = progression.categories.map((category, index) => {
      const names = category.subcategories.flatMap((s) => s.scenarios.map((x) => x.scenario));
      const points = categorySeries(runs, names, topOf, withArchive ? topScores.scores : undefined);
      return {
        name: category.name,
        type: 'line',
        showSymbol: true,
        symbolSize: 5,
        data: points.map((p) => [p.t.getTime(), Math.round(p.value * 10) / 10]),
        lineStyle: { width: 2, color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] },
        itemStyle: { color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] },
      };
    });

    return {
      grid: { left: 56, right: 16, top: 40, bottom: 32 },
      legend: { top: 0, textStyle: { color: '#cbd5e1' } },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => (typeof v === 'number' ? `${v}%` : String(v)),
      },
      xAxis: { type: 'time', axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%' }, scale: true },
      series,
    };
  }, [runs, activeBenchmark, progression, topScores, withArchive]);

  if (!option) return null;
  return (
    <div className="flex flex-col gap-2">
      {topScores.scores.size > 0 && (
        <label className="flex cursor-pointer items-center gap-2 self-end text-xs text-slate-400">
          <input
            type="checkbox"
            className="accent-sky-500"
            checked={withArchive}
            onChange={(event) => setWithArchive(event.target.checked)}
          />
          起点算上存档（TopScores.sav）里的最高分
          <span className="text-slate-600">
            {withArchive ? '看现在处在哪一档' : '只看 stats 目录还留着这一段的变化'}
          </span>
        </label>
      )}
      <EChart option={option} height={height} />
    </div>
  );
}
