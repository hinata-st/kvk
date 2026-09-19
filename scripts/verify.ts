/**
 * 用真实的本地 stats 目录验证整条数据管道。
 *
 * 用法：
 *   npm run verify
 *   STATS_DIR=... BENCHMARK_ID=686 PLAYER_STEAM_ID=... npm run verify
 *
 * 核心断言：拿本地分数按 rank_maxes 算出的段位，必须和官方返回的 scenario_rank 完全一致。
 * 这条一旦不成立，候选池和过关判定就全是错的（见 docs/adr/0002）。
 *
 * 断言 3 再拉第三个数据源进来：游戏写的 TopScores.sav。它存的是个人最高分缓存，
 * 能补上 stats 目录被清掉的那部分场景（见 docs/adr/0006-topscores-pb-cache.md）。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { groupByDay, splitIntoSessions } from '../src/core/aggregate';
import { parseStatsCsv, parseStatsFileName } from '../src/core/parseStatsCsv';
import { parseTopScores } from '../src/core/parseTopScores';
import { rankForScore } from '../src/core/rank';
import type { Run } from '../src/core/types';
import { fetchBenchmark, fetchPlayerRanks } from '../src/data/kovaaksApi';
import { requireEnv } from './env';

const STATS_DIR = requireEnv(
  'STATS_DIR',
  "KovaaK's 写逐局文件的目录：<Steam 库>/steamapps/common/FPSAimTrainer/FPSAimTrainer/stats",
);
const BENCHMARK_ID = Number(process.env.BENCHMARK_ID ?? 686);
const PLAYER_STEAM_ID = requireEnv('PLAYER_STEAM_ID', '你的 SteamID64，拿去和官方排行榜对分');
/** 可选的第三个数据源，不设就跳过断言 3 */
const TOP_SCORES_PATH = process.env.TOP_SCORES_PATH?.trim() || null;

const READ_BATCH = 200;

async function loadRuns(dir: string): Promise<{ runs: Run[]; skipped: string[] }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && parseStatsFileName(entry.name) !== null)
    .map((entry) => entry.name);

  const runs: Run[] = [];
  const skipped: string[] = [];
  for (let i = 0; i < names.length; i += READ_BATCH) {
    const batch = names.slice(i, i + READ_BATCH);
    const parsed = await Promise.all(
      batch.map(async (name) => {
        const text = await readFile(join(dir, name), 'utf8');
        return parseStatsCsv(text, name);
      }),
    );
    for (let j = 0; j < parsed.length; j++) {
      const run = parsed[j];
      if (run) runs.push(run);
      else skipped.push(batch[j]!);
    }
  }
  runs.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  return { runs, skipped };
}

function fmtDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log(`stats 目录: ${STATS_DIR}`);
  const { runs, skipped } = await loadRuns(STATS_DIR);

  if (runs.length === 0) throw new Error('没有解析出任何一局，检查 STATS_DIR');

  const days = groupByDay(runs);
  const sessions = splitIntoSessions(runs);
  const scenarios = new Set(runs.map((run) => run.scenario));
  const totalHours = runs.reduce((sum, run) => sum + run.durationSec, 0) / 3600;

  console.log('\n=== 本地数据 ===');
  console.log(`  局数           ${runs.length}${skipped.length ? `  (跳过 ${skipped.length} 个无法解析的文件)` : ''}`);
  console.log(`  场景数         ${scenarios.size}`);
  console.log(`  训练日         ${days.size}`);
  console.log(`  训练次数       ${sessions.length}`);
  console.log(`  净训练时长     ${totalHours.toFixed(1)} 小时`);
  console.log(`  时间跨度       ${fmtDate(runs[0]!.startedAt)} ~ ${fmtDate(runs[runs.length - 1]!.startedAt)}`);

  console.log(`\n=== 官方 benchmark ${BENCHMARK_ID} ===`);
  const snapshot = await fetchBenchmark(BENCHMARK_ID);
  if (!snapshot) throw new Error('拉取 benchmark 失败');
  const allScenarios = snapshot.subcategories.flatMap((sub) => sub.scenarios);
  console.log(`  子类别         ${snapshot.subcategories.length}`);
  console.log(`  场景           ${allScenarios.length}`);
  console.log(
    `  段位           ${snapshot.ranks.length - 1} 级：${snapshot.ranks.slice(1).map((r) => r.name).join(' < ')}`,
  );

  const official = await fetchPlayerRanks(BENCHMARK_ID, PLAYER_STEAM_ID);
  if (!official) throw new Error(`拉取玩家 ${PLAYER_STEAM_ID} 的段位失败`);

  const localBest = new Map<string, number>();
  for (const run of runs) {
    const current = localBest.get(run.scenario);
    if (current === undefined || run.score > current) localBest.set(run.scenario, run.score);
  }

  console.log('\n=== 断言 1：本地 PB x 100 是否等于官方 score ===');
  let scoreChecked = 0;
  let scoreMismatch = 0;
  const scoreMisses: string[] = [];
  for (const scenario of allScenarios) {
    const mine = localBest.get(scenario.name);
    const theirs = official.get(scenario.name);
    if (mine === undefined || !theirs) continue;
    scoreChecked++;
    if (Math.abs(mine * 100 - theirs.score) > 1) {
      scoreMismatch++;
      scoreMisses.push(`      ${scenario.name}: 本地 ${mine} x100 = ${mine * 100}，官方 ${theirs.score}`);
    }
  }
  console.log(`  可比对的场景   ${scoreChecked}`);
  console.log(`  不一致         ${scoreMismatch}`);
  for (const line of scoreMisses.slice(0, 10)) console.log(line);

  console.log('\n=== 断言 2：本地算出的段位是否等于官方 scenario_rank ===');
  let rankChecked = 0;
  let rankMismatch = 0;
  const rankMisses: string[] = [];
  for (const scenario of allScenarios) {
    const mine = localBest.get(scenario.name);
    const theirs = official.get(scenario.name);
    if (mine === undefined || !theirs) continue;
    rankChecked++;
    const computed = rankForScore(mine, scenario.rankMaxes);
    if (computed !== theirs.rank) {
      rankMismatch++;
      rankMisses.push(
        `      ${scenario.name}: 本地分数 ${mine} -> 算出 ${computed}，官方 ${theirs.rank}` +
          `（阈值 [${scenario.rankMaxes.slice(0, 3).join(', ')}, ...]）`,
      );
    }
  }
  console.log(`  可比对的场景   ${rankChecked}`);
  console.log(`  不一致         ${rankMismatch}`);
  for (const line of rankMisses.slice(0, 15)) console.log(line);

  console.log('\n=== 断言 3：TopScores.sav 里的个人最高分是否等于官方 score ===');
  let topScoreChecked = 0;
  let topScoreMismatch = 0;
  let topScoreMissing = 0;
  const topScoreMisses: string[] = [];
  const missingScenarios: string[] = [];
  const uncovered: string[] = [];
  try {
    if (TOP_SCORES_PATH === null) throw new Error('没设置 TOP_SCORES_PATH');
    const file = await readFile(TOP_SCORES_PATH);
    const entries = parseTopScores(new Uint8Array(file));
    const cached = new Map(entries.map((entry) => [entry.scenario, entry.score]));
    console.log(`  解析到的场景   ${entries.length}`);
    for (const scenario of allScenarios) {
      const theirs = official.get(scenario.name);
      if (!theirs || theirs.score <= 0) continue;
      const cachedScore = cached.get(scenario.name);
      if (!localBest.has(scenario.name) && cachedScore === undefined) {
        uncovered.push(`${scenario.name}（官方 ${theirs.score / 100}）`);
      }
      if (cachedScore === undefined) {
        topScoreMissing++;
        missingScenarios.push(scenario.name);
        continue;
      }
      topScoreChecked++;
      if (Math.abs(cachedScore * 100 - theirs.score) > 1) {
        topScoreMismatch++;
        topScoreMisses.push(`      ${scenario.name}: 存档 ${cachedScore}，官方 ${theirs.score / 100}`);
      }
    }
    console.log(`  官方有分且能比对 ${topScoreChecked}`);
    console.log(`  不一致           ${topScoreMismatch}`);
    for (const line of topScoreMisses.slice(0, 10)) console.log(line);
    if (topScoreMissing > 0) {
      console.log(`  官方有分但存档没有 ${topScoreMissing}：${missingScenarios.slice(0, 8).join('、')}`);
    }
    console.log('\n=== 两个本地来源都没覆盖到的场景（官方有分，本地全 0） ===');
    if (uncovered.length === 0) console.log('  无');
    for (const line of uncovered) console.log(`  ${line}`);
  } catch (error) {
    console.log(`  跳过：${error instanceof Error ? error.message : String(error)}`);
  }

  const ok = scoreMismatch === 0 && rankMismatch === 0 && topScoreMismatch === 0;
  console.log(`\n${ok ? '通过' : '未通过'}：${rankChecked} 个场景的段位判定${ok ? '全部吻合' : '存在偏差'}`);
  if (!ok) {
    console.log(`\n提示：如果大面积不一致，先确认 PLAYER_STEAM_ID 是不是本地这份数据的账号（当前 ${PLAYER_STEAM_ID}）`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
