import { shiftDay } from './aggregate';
import type { PlanEntry } from './settings';

/**
 * 自动往后排日程。
 *
 * 规则来自训练本身，不是日历：
 *
 * - 一条计划在**当天**的最高分够到 Target Rank 的阈值，就算过关；没过就原样留到明天。
 * - 过关空出来的位置，从候选池里按优先级补（池子是推进引擎算的，差得少的排前面）。
 * - 每天保留几条，跟着**原计划那一天**的条数走：今天排了 2 条，明天生成出来也是 2 条。
 * - 你自己动手排过的那一天，一个字节都不改。
 *
 * 它只写「今天 + 1」及沿途那些自动生成的日子，全靠纯函数算，重复运行结果一样。
 * 见 docs/adr/0007-auto-schedule.md
 */

/** 生成计划时用得到的最小场景信息 */
export interface PlanScenario {
  scenario: string;
  category: string;
  subcategory: string;
}

export interface AdvanceInput {
  plan: readonly PlanEntry[];
  /** 天 -> （场景 -> 当天最高分） */
  bestOfDay: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** 候选池，已经按优先级排好 */
  pool: readonly PlanScenario[];
  /** 场景 -> Target Rank 的阈值。拿不到就别指望过关 */
  thresholdOf: (scenario: string) => number | undefined;
  /** 今天，YYYY-MM-DD */
  today: string;
  /** 最多往后推几天，防止锚点太老时空转 */
  maxSteps?: number;
}

export interface AdvanceResult {
  /** 要写回去的自动计划：天 -> 条目（不含 createdAt） */
  generated: Map<string, PlanScenario[]>;
  /** 撞到步数上限，没推完 */
  truncated: boolean;
}

const DEFAULT_MAX_STEPS = 120;

/** 老数据没有 auto 字段，一律当人工的——宁可少推一天，也不覆盖你排的东西 */
function isManual(entry: PlanEntry): boolean {
  return entry.auto !== true;
}

function passed(
  entry: PlanEntry,
  day: string,
  bestOfDay: AdvanceInput['bestOfDay'],
  thresholdOf: AdvanceInput['thresholdOf'],
): boolean {
  const threshold = thresholdOf(entry.scenario);
  if (threshold === undefined || threshold <= 0) return false;
  const best = bestOfDay.get(day)?.get(entry.scenario) ?? 0;
  return best >= threshold;
}

export function advancePlan(input: AdvanceInput): AdvanceResult {
  const { plan, bestOfDay, pool, thresholdOf, today } = input;
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;

  const byDay = new Map<string, PlanEntry[]>();
  for (const entry of plan) {
    const list = byDay.get(entry.day);
    if (list) list.push(entry);
    else byDay.set(entry.day, [entry]);
  }

  const generated = new Map<string, PlanScenario[]>();
  if (byDay.size === 0) return { generated, truncated: false };

  const first = [...byDay.keys()].sort()[0]!;
  let day = first;
  let steps = 0;

  while (day <= today) {
    if (steps++ >= maxSteps) return { generated, truncated: true };

    const here = byDay.get(day) ?? [];
    if (here.length === 0) break;

    const next = shiftDay(day, 1);
    const existing = byDay.get(next);
    if (existing && existing.some(isManual)) break;

    // 没过关的原样留下
    const carried: PlanScenario[] = [];
    const done = new Set<string>();
    for (const entry of here) {
      if (passed(entry, day, bestOfDay, thresholdOf)) {
        done.add(entry.scenario);
        continue;
      }
      carried.push({
        scenario: entry.scenario,
        category: entry.category,
        subcategory: entry.subcategory,
      });
    }

    // 空出来的位置从池子里按优先级补，补到和原来一样多。
    // 刚过关的那些要挡住：池子是外面算的，可能还停在过关之前的状态。
    const picks: PlanScenario[] = [];
    const taken = new Set(carried.map((c) => c.scenario));
    for (const candidate of pool) {
      if (carried.length + picks.length >= here.length) break;
      if (taken.has(candidate.scenario) || done.has(candidate.scenario)) continue;
      taken.add(candidate.scenario);
      picks.push(candidate);
    }

    const entries = [...carried, ...picks];
    generated.set(next, entries);
    // 让链条能接着往下推，不用回数据库读
    byDay.set(
      next,
      entries.map((entry) => ({
        ...entry,
        day: next,
        benchmarkId: here[0]!.benchmarkId,
        auto: true,
        createdAt: '',
      })),
    );
    day = next;
  }

  return { generated, truncated: false };
}
