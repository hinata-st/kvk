import type { Run } from './types';

/**
 * 聚合粒度。
 * - `run`     一局一个点，最原始
 * - `session` 一次训练一个点，相邻 Run 间隔 >= 30 分钟即断开
 * - `day`     一天一个点
 */
export type Grain = 'run' | 'session' | 'day';

/** 一次训练内允许的最大间隔，超过就认为是两次训练 */
export const SESSION_GAP_MINUTES = 30;

export interface SeriesPoint {
  /** X 轴时间 */
  t: Date;
  /** 这个桶里的最高分 */
  best: number;
  /** 这个桶里的局数 */
  count: number;
}

/** 本机时区下的自然日 key，形如 2026-09-19 */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 该自然日的零点 */
export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 在日期 key 上加减天数，形如 2026-09-19 -> 2026-09-20 */
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

/** 把一局一局的记录按天聚成「当天每个场景的最高分」 */
export function bestByDay(runs: readonly Run[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const run of runs) {
    const key = dayKey(run.startedAt);
    let bucket = result.get(key);
    if (!bucket) {
      bucket = new Map();
      result.set(key, bucket);
    }
    const current = bucket.get(run.scenario);
    if (current === undefined || run.score > current) bucket.set(run.scenario, run.score);
  }
  return result;
}

/** 按自然日分组，返回的 Map 已按日期升序 */
export function groupByDay(runs: readonly Run[]): Map<string, Run[]> {
  const map = new Map<string, Run[]>();
  for (const run of runs) {
    const key = dayKey(run.startedAt);
    const bucket = map.get(key);
    if (bucket) bucket.push(run);
    else map.set(key, [run]);
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  return new Map([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/** 把一串 Run 按间隔切成若干次训练。输入需按时间升序。 */
export function splitIntoSessions(runs: readonly Run[], gapMinutes = SESSION_GAP_MINUTES): Run[][] {
  const sorted = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const sessions: Run[][] = [];
  for (const run of sorted) {
    const current = sessions[sessions.length - 1];
    const prev = current?.[current.length - 1];
    if (!current || !prev) {
      sessions.push([run]);
      continue;
    }
    const gap = (run.startedAt.getTime() - prev.endedAt.getTime()) / 60_000;
    if (gap >= gapMinutes) sessions.push([run]);
    else current.push(run);
  }
  return sessions;
}

/**
 * 游戏时间：每段训练从第一局开始算到最后一局结束，含中间没在打的间隔。
 *
 * 这是「打开了多久游戏」的近似——stats 只记录每一局，在菜单里发呆的时间拿不到。
 * 超过 SESSION_GAP_MINUTES 的间隔算两段，所以在菜单里挂太久不会被算进来。
 */
export function gameSeconds(runs: readonly Run[], gapMinutes = SESSION_GAP_MINUTES): number {
  return splitIntoSessions(runs, gapMinutes).reduce((sum, session) => {
    const first = session[0]!;
    const last = session[session.length - 1]!;
    return sum + (last.endedAt.getTime() - first.startedAt.getTime()) / 1000;
  }, 0);
}

/** 秒数转成「1 小时 12 分」这种给人看的写法 */
export function formatSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return `${Math.round(seconds)} 秒`;
  if (minutes < 60) return `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** 单个场景的曲线。runs 必须已经过滤成这一个场景。 */
export function scenarioSeries(runs: readonly Run[], grain: Grain): SeriesPoint[] {
  const sorted = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  if (grain === 'run') {
    return sorted.map((run) => ({ t: run.startedAt, best: run.score, count: 1 }));
  }

  if (grain === 'session') {
    return splitIntoSessions(sorted).map((session) => ({
      t: session[0]!.startedAt,
      best: Math.max(...session.map((r) => r.score)),
      count: session.length,
    }));
  }

  return [...groupByDay(sorted).entries()].map(([key, bucket]) => ({
    t: new Date(`${key}T00:00:00`),
    best: Math.max(...bucket.map((r) => r.score)),
    count: bucket.length,
  }));
}

export interface CategoryPoint {
  t: Date;
  /** 该类别内所有场景的归一化分数的算术平均，单位 % */
  value: number;
  /** 参与平均的场景数 */
  scenarioCount: number;
}

/**
 * 类别对比曲线。
 *
 * 每个场景先算「截至当天的历史最高分 ÷ 该场景最高等级阈值」，得到百分比；
 * 再对类别内所有有阈值的场景取算术平均。结果是累积 PB 曲线，单调不减。
 *
 * 没打过的场景按 0% 计入——它确实是你在这个类别上还没拿到的部分。
 */
export function categorySeries(
  allRuns: readonly Run[],
  scenarioNames: readonly string[],
  topThresholdOf: (scenario: string) => number | null,
  /**
   * 起点成绩：本地逐局文件之外的既有最高分（来自 TopScores.sav）。
   * 不传的话曲线就只反映 stats 目录还留着的那一段，那些被清掉的老成绩会被当成 0。
   */
  baseline?: ReadonlyMap<string, number>,
): CategoryPoint[] {
  const tracked = scenarioNames
    .map((name) => ({ name, top: topThresholdOf(name) }))
    .filter((x): x is { name: string; top: number } => x.top !== null && x.top > 0);

  if (tracked.length === 0) return [];

  const relevant = new Set(tracked.map((x) => x.name));
  const running = new Map<string, number>(
    tracked.map((x) => [x.name, Math.max(0, baseline?.get(x.name) ?? 0)]),
  );
  const byDay = groupByDay(allRuns.filter((r) => relevant.has(r.scenario)));

  const points: CategoryPoint[] = [];
  for (const [key, bucket] of byDay) {
    for (const run of bucket) {
      if (run.score > running.get(run.scenario)!) running.set(run.scenario, run.score);
    }
    let sum = 0;
    for (const { name, top } of tracked) {
      sum += (running.get(name)! / top) * 100;
    }
    points.push({
      t: new Date(`${key}T00:00:00`),
      value: sum / tracked.length,
      scenarioCount: tracked.length,
    });
  }
  return points;
}

