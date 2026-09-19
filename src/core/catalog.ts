import type { CategoryGrouping } from './plan';
import type { BenchmarkSnapshot } from './types';

/**
 * benchmark 目录：名字 + 「大组 -> 子类别」的分组。
 *
 * 这是从 evxl.app 的前端 chunk 里抽出来的社区整理结果，用 npm run catalog 生成，
 * 落在 public/benchmark-catalog.json。它**只是覆盖层**：
 * 结构（有哪些子类别、每个子类别有哪些场景、段位阈值）永远以官方 API 为准。
 * 见 docs/adr/0005-catalog-overlay.md
 */
export interface CatalogSubcategory {
  name: string;
  scenarioCount: number;
}

export interface CatalogCategory {
  name: string;
  subcategories: CatalogSubcategory[];
}

export interface CatalogEntry {
  benchmarkId: number;
  benchmarkName: string;
  difficultyName: string;
  abbreviation: string;
  rankCalculation: string;
  categories: CatalogCategory[];
}

export interface CatalogFile {
  generatedAt: string;
  source: string;
  benchmarks: CatalogEntry[];
}

/**
 * 目录和官方结构对上之后得到的东西。
 *
 * `subcategoryNames` 的 key 是官方 API 的名字（它在同一个 benchmark 里唯一，是身份），
 * value 是目录里的显示名。两者会不一样，比如官方叫 `Speed Track`、目录叫 `Speed`。
 */
export interface CatalogMatch {
  label: string;
  subcategoryNames: Map<string, string>;
  /** 对齐不上就是 null，界面上让用户自己分组 */
  grouping: CategoryGrouping | null;
}

export function catalogIndex(entries: readonly CatalogEntry[]): Map<number, CatalogEntry> {
  return new Map(entries.map((entry) => [entry.benchmarkId, entry]));
}

/** `Viscose Benchmarks / Easier`。难度名和 benchmark 名重复时不啰嗦第二遍。 */
export function entryLabel(entry: CatalogEntry): string {
  const difficulty = entry.difficultyName.trim();
  if (!difficulty || difficulty === entry.benchmarkName) return entry.benchmarkName;
  return `${entry.benchmarkName} / ${difficulty}`;
}

/** 有目录名字就用目录的，没有就退回编号 + 规模。 */
export function benchmarkLabel(snapshot: BenchmarkSnapshot, entry?: CatalogEntry | null): string {
  if (entry) return `${entryLabel(entry)}（#${snapshot.benchmarkId}）`;
  const scenarioCount = snapshot.subcategories.reduce((sum, s) => sum + s.scenarios.length, 0);
  return `#${snapshot.benchmarkId} · ${scenarioCount} 个场景`;
}

function flattenCategories(
  entry: CatalogEntry,
): { category: string; subcategory: string; scenarioCount: number }[] {
  const flat: { category: string; subcategory: string; scenarioCount: number }[] = [];
  for (const category of entry.categories) {
    for (const sub of category.subcategories) {
      flat.push({ category: category.name, subcategory: sub.name, scenarioCount: sub.scenarioCount });
    }
  }
  return flat;
}

/**
 * 把目录对到官方结构上。
 *
 * 官方的 `categories` 层级**不统一**：Viscose 那套里它是叶子（`Arm`、`Wrist`…），
 * Voltaic S5 那套里它是顶层（`Clicking`、`Tracking`、`Switching`），再往下一级才是叶子。
 * 所以这里只认两种**精确**对齐，对不上就只借个名字，不猜分组：
 *
 * 1. 叶子对齐 —— 展平后的 (子类别, 场景数) 序列和官方逐个相等。分组信息可用。
 * 2. 顶层对齐 —— 目录顶层分组的场景数之和与官方逐个相等。只借名字，不给分组。
 *
 * 对不上的情况真实存在（PureG S1 目录 7 组、官方 8 组，目录那边是旧版本），
 * 与其猜，不如不猜。
 */
export function matchCatalog(
  snapshot: BenchmarkSnapshot,
  entry: CatalogEntry | null | undefined,
): CatalogMatch | null {
  if (!entry) return null;
  const label = entryLabel(entry);

  const flat = flattenCategories(entry);
  const sameFlatShape =
    flat.length > 0 &&
    flat.length === snapshot.subcategories.length &&
    flat.every((item, index) => item.scenarioCount === snapshot.subcategories[index]!.scenarios.length);

  if (sameFlatShape) {
    const subcategoryNames = new Map<string, string>();
    snapshot.subcategories.forEach((sub, index) => subcategoryNames.set(sub.name, flat[index]!.subcategory));

    // 分组表里存官方名字（身份），显示名另存在 subcategoryNames 里
    const groupingGroups: { name: string; subcategories: string[] }[] = [];
    flat.forEach((item, index) => {
      const official = snapshot.subcategories[index]!.name;
      const last = groupingGroups[groupingGroups.length - 1];
      if (last && last.name === item.category) last.subcategories.push(official);
      else groupingGroups.push({ name: item.category, subcategories: [official] });
    });
    return { label, subcategoryNames, grouping: { benchmarkId: snapshot.benchmarkId, groups: groupingGroups } };
  }

  const sameTopShape =
    entry.categories.length > 0 &&
    entry.categories.length === snapshot.subcategories.length &&
    entry.categories.every(
      (category, index) =>
        category.subcategories.reduce((sum, s) => sum + s.scenarioCount, 0) ===
        snapshot.subcategories[index]!.scenarios.length,
    );

  if (sameTopShape) {
    const subcategoryNames = new Map<string, string>();
    snapshot.subcategories.forEach((sub, index) =>
      subcategoryNames.set(sub.name, entry.categories[index]!.name || sub.name),
    );
    return { label, subcategoryNames, grouping: null };
  }

  return { label, subcategoryNames: new Map(), grouping: null };
}
