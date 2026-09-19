import type { CategoryGrouping } from '../core/plan';

/**
 * 两级分组的兜底值。
 *
 * 官方接口只给平铺的子类别，大组（例如 `Control Tracking`）官方没有这个概念。
 * 正常情况下分组来自 public/benchmark-catalog.json（见 docs/adr/0005-catalog-overlay.md），
 * 这里只是它没有覆盖到、或者对不上的时候的最后一层：**用不上就是正常的**。
 */
export const SEED_GROUPS: CategoryGrouping[] = [
  {
    benchmarkId: 686,
    groups: [
      { name: 'Control Tracking', subcategories: ['Arm', 'Wrist', 'Fingertip', 'Blending'] },
      { name: 'Reactive Tracking', subcategories: ['Control', 'Speed Track', 'Reading Track'] },
      { name: 'Flick Tech', subcategories: ['Speed', 'Stability', 'Micro', 'Evasive'] },
      { name: 'Dynamic Clicking', subcategories: ['Reading', 'Precision', 'Linear'] },
    ],
  },
];

export function seedGroupingFor(benchmarkId: number): CategoryGrouping | null {
  return SEED_GROUPS.find((g) => g.benchmarkId === benchmarkId) ?? null;
}
