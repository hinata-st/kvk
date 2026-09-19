/**
 * 扫一遍 benchmarkId 区间，建立本地 benchmark 目录。
 *
 * 官方没有公开的 benchmark 列表接口，也不返回 benchmark 名字，只认 ID。
 * 不存在返回 {"error":"Benchmark not found"}，是个干净的判定信号。见 docs/adr/0004。
 *
 * 关键：必须区分「不存在」和「临时出错」。并发扫的时候被限流很常见，
 * 如果把限流当成不存在，那条 benchmark 就会被静默漏掉（686 和 687 就是这么丢过一次）。
 *
 * 用法：
 *   npm run scan
 *   npm run scan -- --only-failed        只重试上次失败的 ID
 *   npm run scan -- --ids 494,764,2419   只扫指定的 ID
 *   npm run scan -- --from 1 --to 2600 --concurrency 3
 *
 * 可重复运行：已经在输出文件里的 ID 会跳过。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { BenchmarkSnapshot } from '../src/core/types';
import { fetchBenchmarkOutcome } from '../src/data/kovaaksApi';

interface DirectoryFile {
  generatedAt: string;
  range: [number, number];
  /** 上一次仍然失败的 ID，可以用 --only-failed 重试 */
  failedIds: number[];
  /** key 是 benchmarkId 的字符串形式 */
  benchmarks: Record<string, BenchmarkSnapshot>;
}

const OUT_PATH = process.env.OUT ?? 'public/benchmark-directory.json';

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 600;
/** 每个 worker 两次请求之间的间隔，礼貌一点 */
const PACE_MS = 60;

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const ONLY_FAILED = process.argv.includes('--only-failed');
const EXPLICIT_IDS = (() => {
  const index = process.argv.indexOf('--ids');
  if (index === -1) return null;
  return (process.argv[index + 1] ?? '')
    .split(',')
    .map((token) => Number(token.trim()))
    .filter((n) => Number.isFinite(n));
})();

const FROM = arg('from', 1);
/** 上限取 3200：社区目录里已知的最大 ID 是 2975（见 npm run catalog） */
const TO = arg('to', 3200);
const CONCURRENCY = Math.max(1, arg('concurrency', 3));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadExisting(): Promise<DirectoryFile> {
  try {
    const parsed = JSON.parse(await readFile(OUT_PATH, 'utf8')) as DirectoryFile;
    if (parsed && typeof parsed === 'object' && parsed.benchmarks) {
      parsed.failedIds ??= [];
      return parsed;
    }
  } catch {
    // 首次运行，文件还不存在
  }
  return { generatedAt: new Date().toISOString(), range: [FROM, TO], failedIds: [], benchmarks: {} };
}

async function main(): Promise<void> {
  const directory = await loadExisting();
  const known = new Set(Object.keys(directory.benchmarks).map(Number));

  let todo: number[];
  if (EXPLICIT_IDS) {
    todo = EXPLICIT_IDS;
  } else if (ONLY_FAILED) {
    todo = [...directory.failedIds];
  } else {
    todo = [];
    for (let id = FROM; id <= TO; id++) if (!known.has(id)) todo.push(id);
  }

  console.log(
    `区间 ${FROM}..${TO}，已有 ${known.size} 个，待扫 ${todo.length} 个，并发 ${CONCURRENCY}`,
  );

  let cursor = 0;
  let found = 0;
  let done = 0;
  const failedIds: number[] = [];

  async function worker(): Promise<void> {
    while (cursor < todo.length) {
      const id = todo[cursor++]!;
      let outcome = await fetchBenchmarkOutcome(id);
      for (let attempt = 1; attempt < MAX_ATTEMPTS && outcome.status === 'error'; attempt++) {
        await sleep(RETRY_DELAY_MS * attempt);
        outcome = await fetchBenchmarkOutcome(id);
      }
      if (outcome.status === 'found') {
        directory.benchmarks[String(id)] = outcome.snapshot;
        found++;
      } else if (outcome.status === 'error') {
        failedIds.push(id);
      }
      done++;
      if (done % 50 === 0) {
        process.stdout.write(`\r  已扫 ${done}/${todo.length}，命中 ${found}，失败 ${failedIds.length}`);
      }
      await sleep(PACE_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  process.stdout.write(`\r  已扫 ${done}/${todo.length}，命中 ${found}，失败 ${failedIds.length}\n`);

  directory.generatedAt = new Date().toISOString();
  directory.range = [FROM, TO];
  directory.failedIds = failedIds.sort((a, b) => a - b);

  await mkdir(dirname(OUT_PATH), { recursive: true });
  const serialized = JSON.stringify(directory);
  await writeFile(OUT_PATH, serialized, 'utf8');

  console.log(
    `目录已写入 ${OUT_PATH}：${Object.keys(directory.benchmarks).length} 个 benchmark，` +
      `${(serialized.length / 1024 / 1024).toFixed(1)} MB`,
  );
  if (failedIds.length > 0) {
    console.log(`仍然失败 ${failedIds.length} 个（npm run scan -- --only-failed 可重试）：${failedIds.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
