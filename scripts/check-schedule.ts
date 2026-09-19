/**
 * 自动排程的规则测试。纯函数，不需要真实数据，跑得飞快。
 *
 * 用法：npm run check-schedule
 *
 * 这些规则一旦错了，日历会静默地把你该练的东西换掉，所以每条都单独钉住。
 */
import { advancePlan, type PlanScenario } from '../src/core/schedule';
import type { PlanEntry } from '../src/core/settings';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}\n      期望 ${b}\n      实际 ${a}`);
  }
}

function entry(day: string, scenario: string, auto = false): PlanEntry {
  return {
    day,
    benchmarkId: 686,
    category: 'Control Tracking',
    subcategory: 'Arm',
    scenario,
    auto,
    createdAt: '2026-09-19T00:00:00.000Z',
  };
}

function poolOf(...scenarios: string[]): PlanScenario[] {
  return scenarios.map((scenario) => ({ scenario, category: 'Control Tracking', subcategory: 'Arm' }));
}

const THRESHOLDS = new Map(['A', 'B', 'C', 'D'].map((s) => [s, 100]));
const names = (entries: readonly PlanScenario[] | undefined) => entries?.map((e) => e.scenario) ?? null;

/** 候选池的默认状态：四个人都没达标 */
const POOL = poolOf('A', 'B', 'C', 'D');

function run(options: {
  plan: PlanEntry[];
  scores?: Record<string, Record<string, number>>;
  pool?: PlanScenario[];
  today: string;
}) {
  const bestOfDay = new Map(
    Object.entries(options.scores ?? {}).map(([day, scores]) => [day, new Map(Object.entries(scores))]),
  );
  return advancePlan({
    plan: options.plan,
    bestOfDay,
    pool: options.pool ?? POOL,
    thresholdOf: (scenario) => THRESHOLDS.get(scenario),
    today: options.today,
  });
}

console.log('自动排程');

console.log('\n[1] 过关就换掉，空出的位置从池子里补');
{
  // A 过关之后就不在池子里了，剩下的候选是 B C D
  const result = run({
    plan: [entry('2026-09-19', 'A'), entry('2026-09-19', 'B')],
    scores: { '2026-09-19': { A: 150, B: 20 } },
    pool: poolOf('B', 'C', 'D'),
    today: '2026-09-19',
  });
  check('A 过关换成 C，没过的 B 留下', names(result.generated.get('2026-09-20')), ['B', 'C']);
}

console.log('\n[2] 一个都没过关，原样留到明天');
{
  const result = run({
    plan: [entry('2026-09-19', 'A'), entry('2026-09-19', 'B')],
    scores: { '2026-09-19': { A: 20, B: 20 } },
    today: '2026-09-19',
  });
  check('内容不变', names(result.generated.get('2026-09-20')), ['A', 'B']);
}

console.log('\n[3] 一天都没练，也算没过关');
{
  const result = run({ plan: [entry('2026-09-19', 'A')], today: '2026-09-19' });
  check('照抄到明天', names(result.generated.get('2026-09-20')), ['A']);
}

console.log('\n[4] 手动排过的那天原地不动');
{
  const result = run({
    plan: [entry('2026-09-19', 'A'), entry('2026-09-20', 'D')],
    scores: { '2026-09-19': { A: 150 } },
    today: '2026-09-21',
  });
  check('不生成被手动占住的那天', result.generated.has('2026-09-20'), false);
  check('也不会越过它继续推', names(result.generated.get('2026-09-21')), null);
}

console.log('\n[5] 跳过好几天没开程序，会一天天推过来');
{
  const result = run({ plan: [entry('2026-09-19', 'A')], today: '2026-09-22' });
  check('每天都生成了', [...result.generated.keys()], [
    '2026-09-20',
    '2026-09-21',
    '2026-09-22',
    '2026-09-23',
  ]);
  check('内容一直是 A', names(result.generated.get('2026-09-23')), ['A']);
}

console.log('\n[6] 中间过了关，之后的链子跟着变');
{
  const result = run({
    plan: [entry('2026-09-19', 'A')],
    scores: { '2026-09-20': { A: 150 } },
    pool: poolOf('B', 'C', 'D'),
    today: '2026-09-21',
  });
  check('20 号过了，21 号换成 B', names(result.generated.get('2026-09-21')), ['B']);
  check('21 号没练，22 号还是 B', names(result.generated.get('2026-09-22')), ['B']);
}

console.log('\n[7] 自动生成的那天可以重排，不会被当成人工的');
{
  const result = run({
    plan: [entry('2026-09-19', 'A', true), entry('2026-09-20', 'D', true)],
    scores: { '2026-09-19': { A: 150 } },
    pool: poolOf('B', 'C', 'D'),
    today: '2026-09-21',
  });
  check('20 号被重排成 B', names(result.generated.get('2026-09-20')), ['B']);
  check('21 号接着 B', names(result.generated.get('2026-09-21')), ['B']);
}

console.log('\n[8] 池子空了就只留没过关的');
{
  const result = run({
    plan: [entry('2026-09-19', 'A'), entry('2026-09-19', 'B')],
    scores: { '2026-09-19': { A: 150, B: 150 } },
    pool: [],
    today: '2026-09-19',
  });
  check('两个都过了，明天就没有条目', names(result.generated.get('2026-09-20')), []);
}

console.log('\n[9] 池子是旧的、还含刚过关的场景时，不能又把它排回来');
{
  const result = run({
    plan: [entry('2026-09-19', 'A'), entry('2026-09-19', 'B')],
    scores: { '2026-09-19': { A: 150, B: 20 } },
    pool: poolOf('A', 'B', 'C'),
    today: '2026-09-19',
  });
  check('跳过 A，补进来的是 C', names(result.generated.get('2026-09-20')), ['B', 'C']);
}

console.log('\n[10] 阈值拿不到的场景永远算没过关');
{
  const result = advancePlan({
    plan: [entry('2026-09-19', 'X')],
    bestOfDay: new Map([['2026-09-19', new Map([['X', 99999]])]]),
    pool: POOL,
    thresholdOf: () => undefined,
    today: '2026-09-19',
  });
  check('保留', names(result.generated.get('2026-09-20')), ['X']);
}

console.log('\n[11] 没有计划就不生成任何东西');
{
  check('空', run({ plan: [], today: '2026-09-19' }).generated.size, 0);
}

console.log('\n[12] 重复推演结果一样（幂等）');
{
  const once = run({ plan: [entry('2026-09-19', 'A')], scores: { '2026-09-20': { A: 150 } }, pool: poolOf('B', 'C'), today: '2026-09-21' });
  const twice = run({ plan: [entry('2026-09-19', 'A')], scores: { '2026-09-20': { A: 150 } }, pool: poolOf('B', 'C'), today: '2026-09-21' });
  check('两次结果一样', names(twice.generated.get('2026-09-22')), names(once.generated.get('2026-09-22')));
}

console.log(
  failures === 0 ? '\n通过：自动排程的规则全部符合预期' : `\n未通过：${failures} 条不符合预期`,
);
process.exit(failures === 0 ? 0 : 1);
