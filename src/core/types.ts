/**
 * 本项目里最小的成绩事实单位：KovaaK's 每次完成一个场景后写出的一个 stats 文件。
 */
export interface Run {
  /** 场景名，来自 CSV 里的 `Scenario:` 字段，例如 "Flower Easier" */
  scenario: string;
  /** 开始时间（本机时区）。来自文件名日期 + CSV 里的 `Challenge Start:` */
  startedAt: Date;
  /** 结束时间，来自文件名里的时间戳 */
  endedAt: Date;
  /** 一局时长（秒） */
  durationSec: number;
  /**
   * 分数，游戏内显示的单位（两位小数）。
   * 注意：官方 API 返回的 score 是它的 100 倍，见 docs/adr/0002-score-unit-100x.md
   */
  score: number;
  /** 设置快照，用于回看 */
  settings: RunSettings;
  /** stats 文件里的 Hash，可与官方排行榜记录对上 */
  hash: string;
  /** 来源文件名，用于排查 */
  sourceFile: string;
}

export interface RunSettings {
  /** 当 `Sens Scale` 为 cm/360 时，`Horiz Sens` 就是 cm/360；否则为 null */
  cm360: number | null;
  /** 例如 "cm/360" */
  sensScale: string;
  dpi: number | null;
  fov: number | null;
  /** 例如 "2560x1440" */
  resolution: string;
}

/** 一个段位，来自官方接口的 `ranks` 字段 */
export interface BenchmarkRank {
  name: string;
  color: string;
  icon: string;
}

/** 叶子层的一个练习场景，对应官方接口里的一个 category 下的一个 scenario */
export interface BenchmarkScenario {
  name: string;
  leaderboardId: number;
  /** 阈值数组，从小到大。分数 >= rankMaxes[i] 时段位为 i+1 */
  rankMaxes: number[];
}

/**
 * 官方接口返回的那一级分组（evxl 叫它子类别），例如 `Arm`。
 * 本项目另外维护一层 Category（大组），见 docs/adr/0004。
 */
export interface BenchmarkSubcategory {
  name: string;
  rankMaxes: number[];
  scenarios: BenchmarkScenario[];
}

/** 一个 Benchmark 档位的完整快照 */
export interface BenchmarkSnapshot {
  benchmarkId: number;
  /** 官方接口不返回名字，只能另外补 */
  name: string | null;
  /** 下标 0 是 "No Rank"，下标 i 对应段位 i */
  ranks: BenchmarkRank[];
  subcategories: BenchmarkSubcategory[];
  fetchedAt: string;
}
