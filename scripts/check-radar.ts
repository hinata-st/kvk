/**
 * 雷达图与变化百分比的规则测试。纯函数，不需要真实数据，跑得飞快。
 *
 * 用法：npm run check-radar
 *
 * 这些规则错了，主页会把「练到哪儿了」画歪，而且歪得很像那么回事，所以每条都单独钉住。
 */
import { changePct, seriesChangePct } from '../src/core/aggregate';
import { computeProgression } from '../src/core/plan';
import { buildRadar } from '../src/core/radar';
import { rankProgress } from '../src/core/rank';
import type { BenchmarkSnapshot, Run } from '../src/core/types';

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

/** 四段，每一段的门槛都是 100 / 200 / 300 / 400 */
const THRESHOLDS = [100, 200, 300, 400];
const RANK_NAMES = ['No Rank', 'Inept', 'Adept', 'Masterful', 'Celestial'];

function snapshot(): BenchmarkSnapshot {
  const scenario = (name: string) => ({ name, leaderboardId: 0, rankMaxes: THRESHOLDS });
  return {
    benchmarkId: 686,
    name: '假的',
    ranks: RANK_NAMES.map((name) => ({ name, color: '#888888', icon: '' })),
    // 没给分组时官方这一级各自成组，所以这里就是两个大组：Arm 和 Dodge
    subcategories: [
      { name: 'Arm', rankMaxes: THRESHOLDS, scenarios: [scenario('A'), scenario('B')] },
      { name: 'Dodge', rankMaxes: THRESHOLDS, scenarios: [scenario('C')] },
    ],
    fetchedAt: '2026-09-19T00:00:00.000Z',
  };
}

function run(scenario: string, day: string, score: number): Run {
  const startedAt = new Date(`${day}T10:00:00`);
  return {
    scenario,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 60_000),
    durationSec: 60,
    score,
    settings: { cm360: null, sensScale: 'cm/360', dpi: null, fov: null, resolution: '2560x1440' },
    hash: `${scenario}-${day}`,
    sourceFile: `${scenario}-${day}.csv`,
  };
}

const BEST = new Map([
  ['A', 350],
  ['B', 200],
  ['C', 50],
]);

const RUNS: Run[] = [
  run('A', '2026-09-01', 150),
  run('A', '2026-09-01', 200),
  run('A', '2026-09-05', 350),
  run('B', '2026-09-01', 200),
  run('C', '2026-09-01', 50),
  run('C', '2026-09-05', 40),
];

console.log('段位进度（雷达图每根轴上的值）：');
check('连第一段门槛都没到，按走到第一环的比例算', rankProgress(50, THRESHOLDS), 0.5);
check('正好卡在门槛上，就是整数段位', rankProgress(200, THRESHOLDS), 2);
check('两段之间，带上往下一段走的进度', rankProgress(350, THRESHOLDS), 3.5);
check('顶到最高段位就是段位总数，不再往上飘', rankProgress(999, THRESHOLDS), 4);
check('没有阈值就没得算', rankProgress(100, []), null);

console.log('\n首尾变化百分比：');
check('涨了一半报 +50', changePct(100, 150), 50);
check('掉了就报负数', changePct(100, 80), -20);
check('起点是 0 除不了', changePct(0, 80), null);
check(
  '一个点的曲线没有变化可言',
  seriesChangePct([{ t: new Date('2026-09-01T00:00:00'), best: 100, count: 1 }]),
  null,
);

const progression = computeProgression(snapshot(), null, BEST, 3);

console.log('\n雷达图的轴：');
const byCategory = buildRadar({ level: 'category', progression, runs: RUNS });
check('大组层级每个大组一根轴', byCategory.spokes.map((s) => s.name), ['Arm', 'Dodge']);
check('轴上的值是组内场景的平均段位进度', byCategory.spokes[0]!.value, 2.75);
check('半径上限是段位总数', byCategory.rankCount, 4);
check(
  '大组层级看整张表，不收窄',
  byCategory.scopedToCurrent,
  false,
);
check('组内够到目标段位的场景数', byCategory.spokes[0]!.clearedCount, 1);
check('变化百分比按组内各场景的首尾变化取平均', byCategory.spokes[0]!.changePct, 75);

const byScene = buildRadar({ level: 'scene', progression, runs: RUNS });
check('场景层级只画当前大组（Arm）', byScene.spokes.map((s) => s.name), ['A', 'B']);
check('收窄了就说明一下', byScene.scopedToCurrent, true);
check('每个场景一根轴，值就是它自己的段位进度', byScene.spokes.map((s) => s.value), [3.5, 2]);
check('只有一天数据的场景算不出变化', byScene.spokes[1]!.changePct, null);
check('轴上带着归属，列表里显示得出来', byScene.spokes[0]!.group, 'Arm');

const cleared = computeProgression(
  snapshot(),
  null,
  new Map([
    ['A', 400],
    ['B', 400],
    ['C', 400],
  ]),
  3,
);
const allCleared = buildRadar({ level: 'scene', progression: cleared, runs: RUNS });
check(
  '全部达标后没有「当前大组」，退回整张表',
  allCleared.spokes.map((s) => s.name),
  ['A', 'B', 'C'],
);
check('退回整张表就不算收窄', allCleared.scopedToCurrent, false);

console.log(failures === 0 ? '\n全过' : `\n挂了 ${failures} 条`);
if (failures > 0) process.exit(1);