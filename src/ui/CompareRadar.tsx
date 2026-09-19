import { useEffect, useMemo, useRef, useState } from 'react';
import type { EChartsOption } from 'echarts';

import { useStore } from '../app/store';
import { buildRadar, type RadarLevel, type RadarSpoke } from '../core/radar';
import { EChart } from './EChart';
import { CATEGORY_PALETTE } from './palette';

const LEVELS: { value: RadarLevel; label: string }[] = [
  { value: 'category', label: '大组' },
  { value: 'subcategory', label: '子类别' },
  { value: 'scene', label: '场景' },
];

/** 雷达的半径和圆心（相对图框）。环上那些段位名要按同一套比例算位置，所以提出来当常量。 */
const RADIUS_RATIO = 0.68;
const CENTER_RATIO = 0.5;

const PROGRESS_COLOR = '#34d399';
const TARGET_COLOR = '#f59e0b';

function pctText(pct: number | null): string {
  if (pct === null) return '—';
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

/**
 * 大组对比。
 *
 * 之前这里画的是一组累积 PB 曲线，问题是所有大组的线都挤在同一个高度区间里，看不出
 * 谁强谁弱——而且「今天练的这个组排第几」得横向比五条线才读得出来。换成雷达之后，
 * 每根轴是一个大组，离圆心的距离直接就是它现在处在哪一段位，一眼就能分出高低。
 *
 * 半径不是分数百分比：分数各轴差好几个数量级，画不到一张雷达上。段位是这张 benchmark
 * 里唯一共同的尺子，所以轴上的值是段位序号（4.2 = 刚进第四段两成）。
 */
export function CompareRadar({
  height = 480,
  onOpenScenario,
}: {
  height?: number;
  onOpenScenario?: (scenario: string) => void;
}) {
  const { runs, activeBenchmark, progression, settings } = useStore();
  const [level, setLevel] = useState<RadarLevel>('category');
  const [showNames, setShowNames] = useState(true);
  const [sorted, setSorted] = useState(false);

  const data = useMemo(
    () => (progression ? buildRadar({ level, progression, runs }) : null),
    [level, progression, runs],
  );

  const spokes = useMemo(() => {
    if (!data) return [];
    return sorted ? [...data.spokes].sort((a, b) => b.value - a.value) : data.spokes;
  }, [data, sorted]);

  /**
   * 颜色跟着分组走，不跟着轴的位置走——换个层级、排个序，同一个分组还是同一个色。
   * 大组层级按大组上色；子类别和场景层级按子类别上色，不然一屏全是同一个色。
   */
  const colorOf = useMemo(() => {
    const categoryIndex = new Map<string, number>();
    const subcategoryIndex = new Map<string, number>();
    let running = 0;
    for (const [index, category] of (progression?.categories ?? []).entries()) {
      categoryIndex.set(category.name, index);
      for (const sub of category.subcategories) subcategoryIndex.set(sub.name, running++);
    }
    const pick = (index: number) => CATEGORY_PALETTE[index % CATEGORY_PALETTE.length]!;
    return (key: { category: string | null; subcategory: string | null }) => {
      const sub = key.subcategory === null ? undefined : subcategoryIndex.get(key.subcategory);
      if (sub !== undefined) return pick(sub);
      const category = key.category === null ? undefined : categoryIndex.get(key.category);
      return pick(category ?? 0);
    };
  }, [progression]);

  const ranks = activeBenchmark?.ranks ?? [];
  const rankNameOf = (value: number) => {
    const index = Math.min(ranks.length - 1, Math.max(0, Math.floor(value)));
    return ranks[index]?.name ?? `等级 ${Math.floor(value)}`;
  };
  const rankColorOf = (value: number) =>
    ranks[Math.max(0, Math.floor(value))]?.color ?? '#94a3b8';

  const option = useMemo<EChartsOption | null>(() => {
    if (!data || spokes.length === 0 || ranks.length === 0) return null;
    const targetRank = settings.targetRank;
    return {
      radar: {
        indicator: spokes.map((spoke) => ({ name: spoke.name, max: data.rankCount })),
        radius: `${RADIUS_RATIO * 100}%`,
        center: ['50%', `${CENTER_RATIO * 100}%`],
        // 环画在每一段位上，和图外那列段位名一一对应
        splitNumber: data.rankCount,
        axisName: { show: showNames, color: '#94a3b8', fontSize: 11, width: 108, overflow: 'truncate' },
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.16)' } },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.16)' } },
        splitArea: { show: false },
      },
      tooltip: {
        trigger: 'item',
        // 指着某个点时只报那根轴；指着多边形时 ECharts 给不出轴名，就把整圈列出来
        formatter: (raw: unknown) => {
          const name = (raw as { name?: string } | undefined)?.name;
          const hovered = spokes.find((spoke) => spoke.name === name);
          return (hovered ? [hovered] : spokes)
            .map(
              (spoke) =>
                `${spoke.name}　${rankNameOf(spoke.value)} ${spoke.value.toFixed(1)} 级　${pctText(spoke.changePct)}`,
            )
            .join('<br/>');
        },
      },
      series: [
        {
          name: '当前',
          type: 'radar',
          symbolSize: 5,
          data: [{ value: spokes.map((spoke) => Math.round(spoke.value * 100) / 100) }],
          lineStyle: { width: 2, color: PROGRESS_COLOR },
          itemStyle: { color: PROGRESS_COLOR },
          areaStyle: { color: PROGRESS_COLOR, opacity: 0.2 },
          emphasis: { areaStyle: { opacity: 0.3 } },
        },
        {
          name: `目标 ${rankNameOf(targetRank)}`,
          type: 'radar',
          silent: true,
          symbol: 'none',
          data: [{ value: spokes.map(() => targetRank) }],
          lineStyle: { type: 'dashed', width: 1, color: TARGET_COLOR },
          itemStyle: { color: TARGET_COLOR },
        },
      ],
    };
  }, [data, spokes, ranks, showNames, settings.targetRank]);

  /** 环上的段位名用 HTML 画：ECharts 的 radar.axisLabel 会在每根轴上重复一遍，14 根轴就是一团糊 */
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const update = () => setBoxWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rings = useMemo(() => {
    if (!data || ranks.length === 0 || data.rankCount === 0) return [];
    const size = Math.min(boxWidth || height, height);
    const radius = (RADIUS_RATIO * size) / 2;
    return ranks.slice(1, data.rankCount + 1).map((rank, index) => ({
      name: rank.name,
      top: height * CENTER_RATIO - (radius * (index + 1)) / data.rankCount,
    }));
  }, [data, ranks, boxWidth, height]);

  if (!progression || !activeBenchmark || !data || !option) return null;

  const currentName = progression.current?.name ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {data.scopedToCurrent && currentName ? `只画当前大组「${currentName}」；` : '整张 benchmark；'}
          离圆心越远段位越高，虚线圈是目标
        </span>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex gap-1">
            {LEVELS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`rounded px-2 py-1 text-xs transition ${
                  level === item.value
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-700/60 text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => setLevel(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={showNames}
              onChange={(event) => setShowNames(event.target.checked)}
            />
            标签
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={sorted}
              onChange={(event) => setSorted(event.target.checked)}
            />
            按进度排
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <ul className="flex flex-col gap-1.5">
          {spokes.map((spoke: RadarSpoke) => {
            const color = colorOf({
              category: level === 'category' ? spoke.name : spoke.group,
              subcategory: spoke.subcategory,
            });
            const inCurrent = currentName !== null && (spoke.group ?? spoke.name) === currentName;
            const context =
              level === 'category'
                ? `${spoke.scenarioCount} 个项目 · ${spoke.clearedCount} 个达标`
                : level === 'subcategory'
                  ? `${spoke.group ?? ''} · 平均 ${spoke.value.toFixed(1)} 级`
                  : (spoke.subcategory ?? '');
            return (
              <li
                key={spoke.name}
                className={`rounded border border-slate-700/60 bg-slate-900/40 px-2 py-1.5 ${
                  inCurrent ? 'bg-sky-500/10' : ''
                }`}
                style={{ borderLeft: `3px solid ${color}` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  {level === 'scene' && onOpenScenario ? (
                    <button
                      type="button"
                      className="truncate text-left text-[13px] text-slate-100 hover:text-sky-400"
                      onClick={() => onOpenScenario(spoke.name)}
                    >
                      {spoke.name}
                    </button>
                  ) : (
                    <span className="truncate text-[13px] text-slate-100">{spoke.name}</span>
                  )}
                  <span className="shrink-0 text-[11px]" style={{ color: rankColorOf(spoke.value) }}>
                    {rankNameOf(spoke.value)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">{context}</span>
                  <span
                    className={`shrink-0 font-mono ${
                      spoke.changePct === null
                        ? 'text-slate-600'
                        : spoke.changePct > 0
                          ? 'text-emerald-400'
                          : spoke.changePct < 0
                            ? 'text-rose-400'
                            : 'text-slate-500'
                    }`}
                  >
                    {pctText(spoke.changePct)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <div ref={boxRef} className="relative mx-auto w-full max-w-[640px]">
          <EChart option={option} height={height} />
          <div className="pointer-events-none absolute inset-0">
            {rings.map((ring) => (
              <div
                key={ring.name}
                className="absolute right-1/2 -translate-y-1/2 pr-2 text-right text-[10px] leading-none text-slate-500"
                style={{ top: ring.top }}
              >
                {ring.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
