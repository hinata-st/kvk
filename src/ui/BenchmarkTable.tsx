import type { ReactNode } from 'react';

import type { CategoryStatus, ScenarioStatus } from '../core/plan';
import { scenarioLaunchUrl } from '../core/launch';
import type { BenchmarkRank } from '../core/types';

import { CATEGORY_PALETTE } from './CategoryCompareChart';

/** 千分位，最多两位小数 */
const num = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** 把 #RRGGBB 压成半透明底色；拿不到合法色值就退回纯色 */
function tint(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

/** 段位色当底色时按亮度挑字色：浅底配深字，深底配白字 */
function readableInk(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return '#0f172a';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 > 0.6 ? '#0f172a' : '#ffffff';
}

/**
 * 当前分数在「上一段位 → 下一段位」这个区间里走了多少（0..1）。
 *
 * 条和百分比都用它：够到的段位整格填满，分数所在的那一格按这个比例斜切。
 * 已经顶到最高段位就没有下一格，算 100%。
 */
function bracketProgress(scenario: ScenarioStatus): number {
  const upper = scenario.rankMaxes[scenario.rank];
  const lower = scenario.rank > 0 ? scenario.rankMaxes[scenario.rank - 1]! : 0;
  if (upper === undefined || upper <= lower) return 1;
  return Math.max(0, Math.min(1, (scenario.best - lower) / (upper - lower)));
}

function ScoreCell({ scenario, progress }: { scenario: ScenarioStatus; progress: number }) {
  return (
    <td className="py-1 pr-3 text-right whitespace-nowrap">
      <span className="font-mono text-slate-100">{num(scenario.best)}</span>
      <span className="ml-2 font-mono text-xs text-slate-500">
        {Math.round(progress * 100)}%
      </span>
    </td>
  );
}

function RankCell({
  rank,
  threshold,
  filled,
  isFirst,
  isLast,
  barColor,
  partial,
}: {
  rank: BenchmarkRank;
  threshold: number | undefined;
  /** 这一格整格填满：分数已经越过它的阈值 */
  filled: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** 整条的颜色取当前段位的，而不是每列各自的 */
  barColor: string | null;
  /** 分数还没到这一格，但已经走了一部分（0..1），斜切填充 */
  partial?: number;
}) {
  const ends = `${isFirst ? 'rounded-l' : ''} ${isLast ? 'rounded-r' : ''}`.trim();
  const bar = barColor ?? rank.color;
  // 斜切：右端用一小段渐变当刀刃，看起来像图里那条被削掉一角的红条
  // 刚起步的一丁点进度不值得画出一条小尾巴，容易被当成渲染瑕疵
  const cut =
    partial === undefined || partial <= 0.005 ? null : Math.max(0, Math.min(100, partial * 100));
  const background = filled
    ? bar
    : cut === null
      ? tint(rank.color, '0d')
      : `linear-gradient(100deg, ${bar} ${Math.max(0, cut - 3).toFixed(1)}%, transparent ${Math.min(100, cut + 3).toFixed(1)}%)`;
  return (
    <td className="py-1 text-right">
      <div
        className={`px-1.5 py-0.5 font-mono text-xs ${
          filled ? `font-bold ${ends}` : cut === null ? 'rounded text-slate-300' : 'rounded text-slate-200'
        }`}
        style={{
          background,
          color: filled ? readableInk(bar) : undefined,
          textShadow: filled ? undefined : '0 1px 3px rgba(2, 6, 23, 0.9)',
          boxShadow: isLast ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.45)' : undefined,
        }}
      >
        {threshold === undefined ? '—' : num(threshold)}
      </div>
    </td>
  );
}

export interface BenchmarkTableProps {
  categories: readonly CategoryStatus[];
  /** 下标 0 是 No Rank，不是可追的段位 */
  ranks: readonly BenchmarkRank[];
  targetRank: number;
  /** 当前正在追的大组，整块高亮 */
  currentCategory: string | null;
  /** 今天已经排进去的场景，按钮要变成「已加入」 */
  plannedToday: ReadonlySet<string>;
  subcategoryLabel: (name: string) => string;
  onAdd: (entry: { category: string; subcategory: string; scenario: string }) => void;
  onOpenScenario: (scenario: string) => void;
}

/**
 * 整个 Benchmark 的分数榜：每个场景的历史最高分、它在每个段位上的阈值，
 * 以及当前落在哪一段（高亮那一格）。大组和子类别按图里的做法竖排在最左边。
 */
export function BenchmarkTable({
  categories,
  ranks,
  targetRank,
  currentCategory,
  plannedToday,
  subcategoryLabel,
  onAdd,
  onOpenScenario,
}: BenchmarkTableProps) {
  const rankNames = ranks.slice(1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="text-[11px] tracking-wide text-slate-500 uppercase">
            <th className="w-6" />
            <th className="w-6" />
            <th className="py-2 pr-3 text-left font-medium">场景</th>
            <th className="py-2 pr-3 text-right font-medium">分数</th>
            {rankNames.map((rank, index) => (
              <th key={rank.name} className="px-1.5 py-2 text-right font-medium" style={{ color: rank.color }}>
                {rank.name}
                {index + 1 === targetRank && <span className="ml-0.5 text-amber-400">◆</span>}
              </th>
            ))}
            <th className="w-24" />
          </tr>
        </thead>
        <tbody>
          {categories.map((category, categoryIndex) => {
            const isCurrent = category.name === currentCategory;
            const color = CATEGORY_PALETTE[categoryIndex % CATEGORY_PALETTE.length]!;
            const rowCount = category.subcategories.reduce((sum, sub) => sum + sub.scenarios.length, 0);
            // 没有大组名时每个子类别各自成组，这时两列会是同一个名字，没必要竖排两次
            const subColumn =
              !(category.subcategories.length === 1 && category.subcategories[0]!.name === category.name);
            const rows: ReactNode[] = [];
            let placedCategory = false;

            for (const sub of category.subcategories) {
              sub.scenarios.forEach((scenario, indexInSub) => {
                const progress = bracketProgress(scenario);
                rows.push(
                  <tr
                    key={scenario.scenario}
                    className={`border-t border-slate-700/40 ${isCurrent ? 'bg-sky-500/[0.07]' : ''}`}
                  >
                    {!placedCategory && (
                      <td
                        rowSpan={rowCount}
                        className={`w-7 border-l-4 bg-slate-900/60 align-middle ${
                          isCurrent ? 'border-cyan-400' : 'border-transparent'
                        }`}
                        style={
                          isCurrent
                            ? { boxShadow: 'inset 6px 0 14px -8px rgba(34, 211, 238, 0.65)' }
                            : undefined
                        }
                      >
                        <div className="flex justify-center px-1.5 py-2 [writing-mode:vertical-rl] rotate-180">
                          <span
                            className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase"
                            style={{
                              color: isCurrent ? '#67e8f9' : color,
                            }}
                          >
                            <span
                              className="inline-block h-1.5 w-1.5 rounded-full"
                              style={{ background: isCurrent ? '#67e8f9' : color }}
                            />
                            {category.name}
                          </span>
                        </div>
                      </td>
                    )}
                    {subColumn && indexInSub === 0 && (
                      <td rowSpan={sub.scenarios.length} className="w-6 align-middle">
                        <div className="flex justify-center px-0.5 [writing-mode:vertical-rl] rotate-180">
                          <span className="text-[10px] tracking-wide text-slate-500">
                            {subcategoryLabel(sub.name)}
                          </span>
                        </div>
                      </td>
                    )}
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={scenarioLaunchUrl(scenario.scenario)}
                          title={`用 Steam 打开 KovaaK's 并直接进到 ${scenario.scenario}`}
                          className="rounded px-1 py-0.5 text-[11px] leading-none text-slate-500 transition hover:bg-sky-600/20 hover:text-sky-300"
                        >
                          ▶
                        </a>
                        <button
                          type="button"
                          className="text-left text-slate-200 hover:text-sky-400"
                          onClick={() => onOpenScenario(scenario.scenario)}
                        >
                          {scenario.scenario}
                        </button>
                        {scenario.cleared && <span className="text-xs text-emerald-400">✓</span>}
                      </div>
                    </td>
                    <ScoreCell scenario={scenario} progress={progress} />
                    {rankNames.map((rank, index) => (
                      <RankCell
                        key={rank.name}
                        rank={rank}
                        threshold={scenario.rankMaxes[index]}
                        filled={index < scenario.rank}
                        partial={index === scenario.rank ? progress : undefined}
                        isFirst={index === 0}
                        isLast={index === scenario.rank - 1}
                        barColor={(ranks[scenario.rank] ?? ranks[1])?.color ?? null}
                      />
                    ))}
                    <td className="py-1 pl-2 text-right">
                      <button
                        type="button"
                        disabled={plannedToday.has(scenario.scenario)}
                        className="rounded border border-sky-600 px-2 py-0.5 text-xs text-sky-400 transition hover:bg-sky-600/20 disabled:border-slate-700 disabled:text-slate-600"
                        onClick={() =>
                          onAdd({
                            category: category.name,
                            subcategory: sub.name,
                            scenario: scenario.scenario,
                          })
                        }
                      >
                        {plannedToday.has(scenario.scenario) ? 'added' : 'add'}
                      </button>
                    </td>
                  </tr>,
                );
                placedCategory = true;
              });
            }
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}
