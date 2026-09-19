/**
 * 端到端冒烟：真实 stats 目录 + 真实 benchmark 目录 -> 推进引擎的输出。
 * 用法：npm run smoke
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { categorySeries } from '../src/core/aggregate';
import { parseStatsCsv, parseStatsFileName } from '../src/core/parseStatsCsv';
import { parseTopScores } from '../src/core/parseTopScores';
import { computeProgression } from '../src/core/plan';
import { topThreshold } from '../src/core/rank';
import type { BenchmarkSnapshot, Run } from '../src/core/types';
import { seedGroupingFor } from '../src/data/seedGroups';
import { requireEnv } from './env';

const STATS_DIR = requireEnv(
  'STATS_DIR',
  "KovaaK's 写逐局文件的目录：<Steam 库>/steamapps/common/FPSAimTrainer/FPSAimTrainer/stats",
);
const DIRECTORY = 'public/benchmark-directory.json';
const BENCHMARK_ID = Number(process.env.BENCHMARK_ID ?? 686);
const TARGET_RANK = Number(process.env.TARGET_RANK ?? 7);
/** 可选的第三个数据源，不设就跳过（只是那些被清掉的老成绩会当成 0 分） */
const TOP_SCORES_PATH = process.env.TOP_SCORES_PATH?.trim() || null;

async function main(): Promise<void> {
  const entries = await readdir(STATS_DIR, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile() && parseStatsFileName(e.name) !== null).map((e) => e.name);
  const runs: Run[] = [];
  for (const name of names) {
    const run = parseStatsCsv(await readFile(join(STATS_DIR, name), 'utf8'), name);
    if (run) runs.push(run);
  }

  const directory = JSON.parse(await readFile(DIRECTORY, 'utf8')) as {
    benchmarks: Record<string, BenchmarkSnapshot>;
  };
  const snapshot = directory.benchmarks[String(BENCHMARK_ID)];
  if (!snapshot) throw new Error(`目录里没有 benchmark ${BENCHMARK_ID}`);

  const bestByScenario = new Map<string, number>();
  for (const run of runs) {
    const current = bestByScenario.get(run.scenario);
    if (current === undefined || run.score > current) bestByScenario.set(run.scenario, run.score);
  }

  // 存档里的个人最高分，和界面用的是同一份逻辑：取大的那个
  let cached = new Map<string, number>();
  if (TOP_SCORES_PATH === null) {
    console.log('没读存档：没设置 TOP_SCORES_PATH\n');
  } else {
    try {
      const entries = parseTopScores(new Uint8Array(await readFile(TOP_SCORES_PATH)));
      cached = new Map(entries.map((entry) => [entry.scenario, entry.score]));
      for (const [scenario, score] of cached) {
        if ((bestByScenario.get(scenario) ?? 0) < score) bestByScenario.set(scenario, score);
      }
      console.log(`存档里的最高分：${cached.size} 个场景（${TOP_SCORES_PATH}）\n`);
    } catch (error) {
      console.log(`没读存档：${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  const progression = computeProgression(snapshot, seedGroupingFor(BENCHMARK_ID), bestByScenario, TARGET_RANK);

  const rankName = (r: number) => snapshot.ranks[r]?.name ?? `等级 ${r}`;
  console.log(`benchmark #${BENCHMARK_ID}（目录里共 ${Object.keys(directory.benchmarks).length} 个）`);
  console.log(`目标等级 ${TARGET_RANK} = ${rankName(TARGET_RANK)}\n`);

  for (const category of progression.categories) {
    console.log(`${category.cleared ? '[达标]  ' : '[未达标]'} ${category.name}`);
    for (const sub of category.subcategories) {
      const bad = sub.scenarios.filter((s) => !s.cleared);
      console.log(
        `    ${sub.name.padEnd(16)} 段位 ${sub.rank} (${rankName(sub.rank)})` +
          (bad.length ? `  <-- 未达标 ${bad.length} 个` : ''),
      );
    }
  }

  console.log(`\n当前大组：${progression.current?.name ?? '（全部达标）'}`);
  console.log(`候选池 ${progression.candidates.length} 个：`);
  for (const candidate of progression.candidates) {
    console.log(
      `    ${candidate.scenario.padEnd(44)} ${candidate.subcategory.padEnd(12)}` +
        ` PB ${String(candidate.best).padEnd(10)} 差 ${candidate.pointsToTarget} 分 / ${candidate.ranksBehind} 级`,
    );
  }

  const topOf = (scenario: string) => {
    for (const sub of snapshot.subcategories) {
      for (const s of sub.scenarios) if (s.name === scenario) return topThreshold(s.rankMaxes);
    }
    return null;
  };
  console.log('\n大组对比曲线（最后一行的百分比，按累积 PB 平均）：');
  for (const category of progression.categories) {
    const scenarioNames = category.subcategories.flatMap((s) => s.scenarios.map((x) => x.scenario));
    const points = categorySeries(runs, scenarioNames, topOf, cached);
    const last = points[points.length - 1];
    console.log(
      `    ${category.name.padEnd(18)} ${points.length} 个点   最新 ${last ? last.value.toFixed(1) : '—'}%` +
        `   场景 ${last?.scenarioCount ?? 0} 个`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
