/**
 * 从 evxl.app 的静态 JS 里抽出 benchmark 目录：名字、缩写、难度、两级分组。
 *
 * 为什么需要它：KovaaK's 官方 API 对任意 benchmarkId 都返回完整结构，但**不返回名字**
 * （见 docs/adr/0004）。只有 ID 的列表在界面上没法挑。evxl 把社区 benchmark 的名字和
 * 「大组 -> 子类别」的整理结果硬编码在它的前端 chunk 里，这里把它抽出来当**覆盖层**用：
 * 结构仍以官方 API 为准，名字和分组从这里补。见 docs/adr/0005-catalog-overlay.md
 *
 * 用法：npm run catalog
 *
 * 注意：chunk 的文件名带内容 hash，每次部署都会变。所以这里不写死路径，
 * 而是从首页的 modulepreload 列表里逐个找，谁能解析出 catalog 就用谁。
 * 找不到时会**保留旧文件并报错退出**，绝不写出一个空目录。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const SITE = 'https://evxl.app';
const OUT_PATH = process.env.OUT ?? 'public/benchmark-catalog.json';

/** chunk 里被 JSON.parse 的那段：const o=JSON.parse(`[{...}]`) */
const MARKER = 'JSON.parse(`';
const SHAPE = '{"benchmarkName"';

interface RawSubcategory {
  subcategoryName?: string;
  scenarioCount?: number;
}
interface RawCategory {
  categoryName?: string;
  subcategories?: RawSubcategory[];
}
interface RawDifficulty {
  difficultyName?: string;
  kovaaksBenchmarkId?: number;
  categories?: RawCategory[];
}
interface RawBenchmark {
  benchmarkName?: string;
  abbreviation?: string;
  rankCalculation?: string;
  difficulties?: RawDifficulty[];
}

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
  /** 与 KovaaK's 官方的算法标记保持原样，暂时只存不用 */
  rankCalculation: string;
  categories: CatalogCategory[];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** 首页里出现的所有 JS chunk 地址 */
function chunkUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="([^"]+\.js)"/g)) {
    urls.add(new URL(match[1]!, SITE).toString());
  }
  return [...urls];
}

function extractCatalog(chunk: string): RawBenchmark[] | null {
  const start = chunk.indexOf(MARKER);
  if (start === -1) return null;
  const from = start + MARKER.length;
  const end = chunk.indexOf('`)', from);
  if (end === -1) return null;
  const raw = chunk.slice(from, end);
  if (!raw.startsWith(`[${SHAPE}`)) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RawBenchmark[]) : null;
  } catch {
    return null;
  }
}

/** 名字里混了多余空格（`" Precision"`），统一清掉；空的子类别名字丢掉 */
function tidy(raw: RawBenchmark[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const benchmark of raw) {
    const benchmarkName = (benchmark.benchmarkName ?? '').trim();
    if (!benchmarkName) continue;
    for (const difficulty of benchmark.difficulties ?? []) {
      const benchmarkId = Number(difficulty.kovaaksBenchmarkId ?? 0);
      if (!Number.isFinite(benchmarkId) || benchmarkId <= 0) continue;
      const categories: CatalogCategory[] = [];
      for (const category of difficulty.categories ?? []) {
        const subcategories: CatalogSubcategory[] = [];
        for (const sub of category.subcategories ?? []) {
          const name = (sub.subcategoryName ?? '').trim();
          const scenarioCount = Number(sub.scenarioCount ?? 0);
          if (!name || !(scenarioCount > 0)) continue;
          subcategories.push({ name, scenarioCount });
        }
        if (subcategories.length === 0) continue;
        categories.push({ name: (category.categoryName ?? '').trim(), subcategories });
      }
      entries.push({
        benchmarkId,
        benchmarkName,
        difficultyName: (difficulty.difficultyName ?? '').trim(),
        abbreviation: (benchmark.abbreviation ?? '').trim(),
        rankCalculation: (benchmark.rankCalculation ?? '').trim(),
        categories,
      });
    }
  }
  return entries.sort((a, b) => a.benchmarkId - b.benchmarkId);
}

async function main(): Promise<void> {
  const html = await fetchText(`${SITE}/`);
  if (!html) throw new Error(`拿不到 ${SITE} 的首页`);

  const urls = chunkUrls(html);
  console.log(`首页上有 ${urls.length} 个 JS 文件，逐个找 catalog…`);

  let raw: RawBenchmark[] | null = null;
  let hit = '';
  for (const url of urls) {
    const chunk = await fetchText(url);
    if (!chunk) continue;
    const parsed = extractCatalog(chunk);
    if (parsed) {
      raw = parsed;
      hit = url;
      break;
    }
  }
  if (!raw) throw new Error('所有 chunk 里都没找到 benchmark catalog');

  const entries = tidy(raw);
  if (entries.length < 100) {
    throw new Error(`只抽出 ${entries.length} 条，明显不对。保留旧文件不覆盖。`);
  }

  const withCategories = entries.filter((e) => e.categories.length > 0).length;
  const payload = {
    generatedAt: new Date().toISOString(),
    source: hit,
    benchmarks: entries,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload), 'utf8');

  const benchmarks = new Set(entries.map((e) => e.benchmarkName)).size;
  console.log(
    `目录已写入 ${OUT_PATH}：${benchmarks} 个 benchmark、${entries.length} 个难度，` +
      `其中 ${withCategories} 个带分组（来自 ${hit}）`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
