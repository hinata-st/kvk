import { pointsToTarget, rankForScore } from './rank';
import type { BenchmarkScenario, BenchmarkSnapshot, BenchmarkSubcategory } from './types';

/**
 * 两级分组。官方接口只给平铺的子类别，大组是社区概念，官方没有，得自己维护。
 * 见 docs/adr/0004-benchmark-directory-by-id-scan.md
 */
export interface CategoryGrouping {
  benchmarkId: number;
  /** 大组名 -> 子类别名列表。没有列到的子类别各自成组。 */
  groups: { name: string; subcategories: string[] }[];
}

export interface ScenarioStatus {
  scenario: string;
  subcategory: string;
  rankMaxes: number[];
  /** 你的历史最高分，本地单位 */
  best: number;
  /** 历史最高分对应的段位 */
  rank: number;
  /** 距离 Target Rank 还差多少分；已达标为 0 */
  pointsToTarget: number;
  /** 还差几个段位 */
  ranksBehind: number;
  cleared: boolean;
}

export interface SubcategoryStatus {
  name: string;
  rank: number;
  cleared: boolean;
  scenarios: ScenarioStatus[];
}

export interface CategoryStatus {
  name: string;
  subcategories: SubcategoryStatus[];
  cleared: boolean;
}

export interface Progression {
  targetRank: number;
  categories: CategoryStatus[];
  /** 当前该练的大组：第一个还没达标的 */
  current: CategoryStatus | null;
  /** 候选池：当前大组里还没达标的场景，离达标最近的排前面 */
  candidates: ScenarioStatus[];
}

/** 把一个 benchmark 的子类别按分组归拢；没有分组信息时每个子类别各自成组。 */
export function buildGroups(
  snapshot: BenchmarkSnapshot,
  grouping: CategoryGrouping | null,
): { name: string; subcategories: BenchmarkSubcategory[] }[] {
  const byName = new Map(snapshot.subcategories.map((s) => [s.name, s]));
  const used = new Set<string>();
  const groups: { name: string; subcategories: BenchmarkSubcategory[] }[] = [];

  for (const group of grouping?.groups ?? []) {
    // 目录里有 56 个 benchmark 的顶层分组名是空的（例如 Underaim）。空名字当不了大组名：
    // 用它的话整个 benchmark 会缩成一个没名字的大组，推进和高亮都没法看。
    // 跳过之后，这些子类别会在下面各自成组。
    const groupName = group.name.trim();
    if (groupName === '') continue;
    const members: BenchmarkSubcategory[] = [];
    for (const name of group.subcategories) {
      const sub = byName.get(name);
      if (sub && !used.has(name)) {
        members.push(sub);
        used.add(name);
      }
    }
    if (members.length > 0) groups.push({ name: groupName, subcategories: members });
  }

  for (const sub of snapshot.subcategories) {
    if (!used.has(sub.name)) groups.push({ name: sub.name, subcategories: [sub] });
  }
  return groups;
}

function scoreScenario(
  scenario: BenchmarkScenario,
  subcategory: string,
  best: number,
  targetRank: number,
): ScenarioStatus {
  const rank = rankForScore(best, scenario.rankMaxes);
  const gap = targetRank - rank;
  return {
    scenario: scenario.name,
    subcategory,
    rankMaxes: scenario.rankMaxes,
    best,
    rank,
    pointsToTarget: pointsToTarget(best, scenario.rankMaxes, targetRank) ?? 0,
    ranksBehind: Math.max(0, gap),
    cleared: rank >= targetRank,
  };
}

/**
 * 推进引擎。
 *
 * 过不过关只看分数，与当天 Quota 是否练满无关。见 docs/adr/0003-progression-engine.md
 */
export function computeProgression(
  snapshot: BenchmarkSnapshot,
  grouping: CategoryGrouping | null,
  bestByScenario: ReadonlyMap<string, number>,
  targetRank: number,
): Progression {
  const categories: CategoryStatus[] = buildGroups(snapshot, grouping).map((group) => {
    const subcategories: SubcategoryStatus[] = group.subcategories.map((sub) => {
      const scenarios = sub.scenarios.map((scenario) =>
        scoreScenario(scenario, sub.name, bestByScenario.get(scenario.name) ?? 0, targetRank),
      );
      const rank = scenarios.reduce((min, s) => Math.min(min, s.rank), Number.POSITIVE_INFINITY);
      const effective = Number.isFinite(rank) ? rank : 0;
      return {
        name: sub.name,
        rank: scenarios.length > 0 ? effective : 0,
        cleared: scenarios.every((s) => s.cleared),
        scenarios,
      };
    });
    return {
      name: group.name,
      subcategories,
      cleared: subcategories.every((s) => s.cleared),
    };
  });

  const current = categories.find((c) => !c.cleared) ?? null;
  const candidates = (current?.subcategories ?? [])
    .flatMap((s) => s.scenarios)
    .filter((s) => !s.cleared)
    .sort((a, b) => a.ranksBehind - b.ranksBehind || a.pointsToTarget - b.pointsToTarget);

  return { targetRank, categories, current, candidates };
}
