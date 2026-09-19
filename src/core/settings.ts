/** 用户可改的设置。 */
export interface Settings {
  /** 当前的活跃 benchmark；null 表示还没选 */
  activeBenchmarkId: number | null;
  /** 目标段位，1 = 最低段位 */
  targetRank: number;
  /** 每日训练量目标，单位是局数 */
  quotaRuns: number;
  /**
   * 自动往后排：每天结束后，把过了关的场景换掉、没过的留到明天，再从候选池补新的。
   * 你自己动手排过的那一天不会被覆盖。见 docs/adr/0007-auto-schedule.md
   */
  autoAdvance: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  activeBenchmarkId: null,
  targetRank: 7,
  quotaRuns: 30,
  autoAdvance: true,
};

/** 日历上的一条计划：某天要练某个场景。 */
export interface PlanEntry {
  /** 自然日，YYYY-MM-DD */
  day: string;
  benchmarkId: number;
  category: string;
  subcategory: string;
  scenario: string;
  /**
   * 自动生成的条目。只有 `true` 才会被自动重排覆盖，
   * `undefined`（老数据、手排的）一律当成人工的，绝不动。
   */
  auto?: boolean;
  createdAt: string;
}
