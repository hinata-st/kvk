import type {
  BenchmarkRank,
  BenchmarkScenario,
  BenchmarkSnapshot,
  BenchmarkSubcategory,
} from '../core/types';

export const KOVAAKS_API_BASE = 'https://kovaaks.com/webapp-backend';

/**
 * 官方接口不校验这个 steamId。用假 ID 就能拿到任意 benchmark 的完整结构，
 * 分数全是 0，但 category / scenario / 阈值 / 段位元数据都是真的。
 */
export const PROBE_STEAM_ID = '00000000000000000';

function benchmarkByIdUrl(benchmarkId: number, steamId: string = PROBE_STEAM_ID): string {
  return (
    `${KOVAAKS_API_BASE}/benchmarks/player-progress-rank-benchmark` +
    `?benchmarkId=${benchmarkId}&steamId=${steamId}&page=0&max=100`
  );
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const n = Number(item);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * 把官方 `player-progress-rank-benchmark` 的响应映射成快照。
 * 响应里带 `error` 时返回 null。
 */
export function mapBenchmarkResponse(benchmarkId: number, raw: unknown): BenchmarkSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null;
  const json = raw as Record<string, unknown>;
  if ('error' in json && json.error) return null;

  const rawCategories = (json.categories ?? {}) as Record<string, unknown>;
  const subcategories: BenchmarkSubcategory[] = [];
  for (const [name, rawCategory] of Object.entries(rawCategories)) {
    const category = (rawCategory ?? {}) as Record<string, unknown>;
    const rawScenarios = (category.scenarios ?? {}) as Record<string, unknown>;
    const scenarios: BenchmarkScenario[] = [];
    for (const [scenarioName, rawScenario] of Object.entries(rawScenarios)) {
      const scenario = (rawScenario ?? {}) as Record<string, unknown>;
      scenarios.push({
        name: scenarioName,
        leaderboardId: Number(scenario.leaderboard_id ?? 0),
        rankMaxes: toNumberArray(scenario.rank_maxes),
      });
    }
    subcategories.push({ name, rankMaxes: toNumberArray(category.rank_maxes), scenarios });
  }

  const ranks: BenchmarkRank[] = [];
  for (const rawRank of Array.isArray(json.ranks) ? json.ranks : []) {
    const rank = (rawRank ?? {}) as Record<string, unknown>;
    ranks.push({
      name: String(rank.name ?? ''),
      color: String(rank.color ?? ''),
      icon: String(rank.icon ?? ''),
    });
  }

  return { benchmarkId, name: null, ranks, subcategories, fetchedAt: new Date().toISOString() };
}

export type BenchmarkFetch =
  | { status: 'found'; snapshot: BenchmarkSnapshot }
  | { status: 'missing' }
  | { status: 'error'; detail: string };

/**
 * 拉一个 benchmark，并且**区分**「不存在」和「临时出错」。
 *
 * 这个区分很关键：并发扫 ID 区间时被限流是常事。如果把它当成「不存在」，
 * 那条 benchmark 就会被静默地从目录里漏掉——我们踩过这个坑，686 和 687 就是这么消失的。
 */
export async function fetchBenchmarkOutcome(
  benchmarkId: number,
  options: { signal?: AbortSignal } = {},
): Promise<BenchmarkFetch> {
  let res: Response;
  try {
    res = await fetch(benchmarkByIdUrl(benchmarkId), { signal: options.signal });
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: 'error', detail: '响应不是合法 JSON' };
  }
  if (json !== null && typeof json === 'object' && 'error' in json) {
    const message = String((json as Record<string, unknown>).error ?? '');
    if (/not found/i.test(message)) return { status: 'missing' };
    return { status: 'error', detail: message || '未知错误' };
  }
  const snapshot = mapBenchmarkResponse(benchmarkId, json);
  if (!snapshot) return { status: 'error', detail: '响应结构不认识' };
  return { status: 'found', snapshot };
}

/** 拉一个 benchmark 的结构。不存在或出错时返回 null。 */
export async function fetchBenchmark(
  benchmarkId: number,
  options: { steamId?: string; signal?: AbortSignal } = {},
): Promise<BenchmarkSnapshot | null> {
  if (options.steamId && options.steamId !== PROBE_STEAM_ID) {
    const res = await fetch(benchmarkByIdUrl(benchmarkId, options.steamId), { signal: options.signal });
    if (!res.ok) return null;
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return null;
    }
    return mapBenchmarkResponse(benchmarkId, json);
  }
  const outcome = await fetchBenchmarkOutcome(benchmarkId, options);
  return outcome.status === 'found' ? outcome.snapshot : null;
}

/** 拉某个玩家在某个 benchmark 里的段位快照：场景名 -> { score, rank, leaderboardId } */
export async function fetchPlayerRanks(
  benchmarkId: number,
  steamId: string,
  signal?: AbortSignal,
): Promise<Map<string, { score: number; rank: number; leaderboardId: number }> | null> {
  const res = await fetch(benchmarkByIdUrl(benchmarkId, steamId), { signal });
  if (!res.ok) return null;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (json === null || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  if (root.error) return null;

  const out = new Map<string, { score: number; rank: number; leaderboardId: number }>();
  const categories = (root.categories ?? {}) as Record<string, unknown>;
  for (const rawCategory of Object.values(categories)) {
    const category = (rawCategory ?? {}) as Record<string, unknown>;
    const scenarios = (category.scenarios ?? {}) as Record<string, unknown>;
    for (const [name, rawScenario] of Object.entries(scenarios)) {
      const scenario = (rawScenario ?? {}) as Record<string, unknown>;
      out.set(name, {
        score: Number(scenario.score ?? 0),
        rank: Number(scenario.scenario_rank ?? 0),
        leaderboardId: Number(scenario.leaderboard_id ?? 0),
      });
    }
  }
  return out;
}
