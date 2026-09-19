import { changePct, groupByDay } from './aggregate';
import type { CategoryStatus, Progression, ScenarioStatus } from './plan';
import { rankProgress } from './rank';
import type { Run } from './types';

/**
 * 雷达图的轴代表哪一级。大组层级看的是整张 benchmark，子类别和场景层级只看当前
 * 正在追的那个大组——全摊开是一二十根轴，挤在一张雷达上什么都读不出来。
 */
export type RadarLevel = 'category' | 'subcategory' | 'scene';

export interface RadarSpoke {
  /** 轴的名字 */
  name: string;
  /** 所属大组。大组层级自己是最大一级，给 null */
  group: string | null;
  /** 所属子类别。只有场景层级用得上，其余给 null */
  subcategory: string | null;
  /** 轴上的值：组内场景的平均段位进度（见 rankProgress，整数部分是段位） */
  value: number;
  scenarioCount: number;
  /** 组内已经够到目标段位的场景数 */
  clearedCount: number;
  /** 首尾变化百分比：组内各场景各自首尾变化的平均。算不出来就是 null */
  changePct: number | null;
}

export interface RadarData {
  spokes: RadarSpoke[];
  /** 半径上限：这个 benchmark 一共几段。外圈就是最高段位 */
  rankCount: number;
  /** 子类别 / 场景层级是不是被收窄到了当前大组 */
  scopedToCurrent: boolean;
}

/** 场景名 -> 按天最高分（升序）。首尾一比就是这段时间的涨幅。 */
function dailyBests(runs: readonly Run[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const bucket of groupByDay(runs).values()) {
    const bestOfDay = new Map<string, number>();
    for (const run of bucket) {
      const current = bestOfDay.get(run.scenario);
      if (current === undefined || run.score > current) bestOfDay.set(run.scenario, run.score);
    }
    for (const [scenario, score] of bestOfDay) {
      const series = result.get(scenario);
      if (series) series.push(score);
      else result.set(scenario, [score]);
    }
  }
  return result;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface SpokeSource {
  name: string;
  group: string | null;
  subcategory: string | null;
  scenarios: readonly ScenarioStatus[];
}

function sourcesOf(level: RadarLevel, categories: readonly CategoryStatus[]): SpokeSource[] {
  if (level === 'category') {
    return categories.map((category) => ({
      name: category.name,
      group: null,
      subcategory: null,
      scenarios: category.subcategories.flatMap((sub) => sub.scenarios),
    }));
  }
  if (level === 'subcategory') {
    return categories.flatMap((category) =>
      category.subcategories.map((sub) => ({
        name: sub.name,
        group: category.name,
        subcategory: null,
        scenarios: sub.scenarios,
      })),
    );
  }
  return categories.flatMap((category) =>
    category.subcategories.flatMap((sub) =>
      sub.scenarios.map((scenario) => ({
        name: scenario.scenario,
        group: category.name,
        subcategory: sub.name,
        scenarios: [scenario],
      })),
    ),
  );
}

/** 首尾变化：拿不到两天的数据就没得比，返回 null。 */
function changeOf(series: readonly number[] | undefined): number | null {
  if (!series || series.length < 2) return null;
  return changePct(series[0]!, series[series.length - 1]!);
}

/**
 * 把进度摊成雷达图要的轴。
 *
 * 每根轴上的值是「组内场景的平均段位进度」，不是分数百分比——段位是这张 benchmark
 * 里唯一共同的尺子，分数各轴差好几个数量级，画不到一张雷达上。没打过的场景按 0 算，
 * 它确实是你还没拿到的部分。
 */
export function buildRadar(input: {
  level: RadarLevel;
  progression: Progression;
  runs: readonly Run[];
}): RadarData {
  const { level, progression, runs } = input;
  const all = progression.categories;
  const current = progression.current;
  const scopedToCurrent = level !== 'category' && current !== null;
  const categories = scopedToCurrent && current ? [current] : all;

  const rankCount = all.reduce(
    (max, category) =>
      Math.max(
        max,
        ...category.subcategories.flatMap((sub) => sub.scenarios.map((s) => s.rankMaxes.length)),
      ),
    0,
  );

  const daily = dailyBests(runs);

  const spokes = sourcesOf(level, categories).map((source) => {
    const values: number[] = [];
    const changes: number[] = [];
    let clearedCount = 0;
    for (const scenario of source.scenarios) {
      const progress = rankProgress(scenario.best, scenario.rankMaxes);
      if (progress !== null) values.push(progress);
      const change = changeOf(daily.get(scenario.scenario));
      if (change !== null) changes.push(change);
      if (scenario.cleared) clearedCount++;
    }
    return {
      name: source.name,
      group: source.group,
      subcategory: source.subcategory,
      value: values.length > 0 ? mean(values) : 0,
      scenarioCount: source.scenarios.length,
      clearedCount,
      changePct: changes.length > 0 ? mean(changes) : null,
    };
  });

  return { spokes, rankCount, scopedToCurrent };
}
