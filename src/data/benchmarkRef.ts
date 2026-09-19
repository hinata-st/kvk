import type { CatalogEntry } from '../core/catalog';

/**
 * 「添加 benchmark」输入框里能接受什么。
 *
 * 官方没有列表接口，所以拿到别人设计的 benchmark 只有两条路：知道 ID，或者知道名字。
 * 这个函数把两者都收下来，交给调用方去解析。
 */
export type BenchmarkRef =
  | { kind: 'id'; benchmarkId: number }
  | { kind: 'name'; benchmarkName: string; difficultyName: string }
  | { kind: 'invalid'; reason: string };

const ID_PATTERN = /\b\d{1,6}\b/;

/**
 * 认这些写法：
 *
 * - `686`、`#686`
 * - `...?benchmarkId=686`、`.../benchmark/686`（kovaaks.com 的链接）
 * - evxl 的用户页：`https://evxl.app/u/76561199.../Viscose%20Benchmarks/Easier`
 *   —— 这种链接里没有 ID，只有名字和难度，所以回退到按目录名字查。
 */
export function parseBenchmarkRef(input: string): BenchmarkRef {
  const text = input.trim();
  if (!text) return { kind: 'invalid', reason: '先粘点东西进来' };

  const fromQuery = /[?&]benchmarkId=(\d+)/i.exec(text);
  if (fromQuery) return { kind: 'id', benchmarkId: Number(fromQuery[1]) };

  const fromPath = /\/benchmarks?\/(\d+)\b/i.exec(text);
  if (fromPath) return { kind: 'id', benchmarkId: Number(fromPath[1]) };

  // evxl 的用户页：/u/<steamid>/<benchmark 名>/<难度>
  const evxl = /\/u\/\d+\/([^/?#]+)\/([^/?#]+)/.exec(text);
  if (evxl) {
    const decode = (value: string) => {
      try {
        return decodeURIComponent(value).trim();
      } catch {
        return value.trim();
      }
    };
    const benchmarkName = decode(evxl[1]!);
    const difficultyName = decode(evxl[2]!);
    if (benchmarkName && difficultyName) return { kind: 'name', benchmarkName, difficultyName };
  }

  if (/^\d{1,6}$/.test(text) || /^#\d{1,6}$/.test(text)) {
    return { kind: 'id', benchmarkId: Number(text.replace('#', '')) };
  }

  const loose = ID_PATTERN.exec(text);
  if (loose && /^\D*\d{1,6}\D*$/.test(text)) return { kind: 'id', benchmarkId: Number(loose[0]) };

  return { kind: 'invalid', reason: '认不出来。给个 benchmarkId，或者粘 evxl / kovaaks 的链接。' };
}

/** 按「名字 + 难度」在目录里找。大小写和多余空格不敏感。 */
export function findEntryByName(
  entries: Iterable<CatalogEntry>,
  benchmarkName: string,
  difficultyName: string,
): CatalogEntry | null {
  const key = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
  const wantedName = key(benchmarkName);
  const wantedDifficulty = key(difficultyName);
  let fallback: CatalogEntry | null = null;
  for (const entry of entries) {
    if (key(entry.benchmarkName) !== wantedName) continue;
    if (key(entry.difficultyName) === wantedDifficulty) return entry;
    fallback ??= entry;
  }
  return fallback;
}
