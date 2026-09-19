import type { CategoryGrouping } from '../core/plan';
import { DEFAULT_SETTINGS, type PlanEntry, type Settings } from '../core/settings';
import type { BenchmarkSnapshot, Run } from '../core/types';

/**
 * 所有持久化都走 IndexedDB，没有服务端。见 docs/adr/0001-no-backend-local-only.md
 *
 * - runs       一局一条，key 用来源文件名（同一目录内唯一）
 * - benchmarks benchmark 目录快照，从官方接口扫来
 * - plan       日历上的计划条目
 * - groups     两级分组，自己维护
 * - meta       设置和目录句柄
 */
const DB_NAME = 'kvk';
const DB_VERSION = 1;

const STORE_RUNS = 'runs';
const STORE_BENCHMARKS = 'benchmarks';
const STORE_PLAN = 'plan';
const STORE_GROUPS = 'groups';
const STORE_META = 'meta';

const KEY_SETTINGS = 'settings';
const KEY_DIR_HANDLE = 'statsDirHandle';
const KEY_TOP_SCORES = 'topScores';

/** 从 TopScores.sav 读出来的个人最高分缓存 */
export interface StoredTopScores {
  importedAt: string;
  fileName: string;
  scores: Record<string, number>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        db.createObjectStore(STORE_RUNS, { keyPath: 'sourceFile' });
      }
      if (!db.objectStoreNames.contains(STORE_BENCHMARKS)) {
        db.createObjectStore(STORE_BENCHMARKS, { keyPath: 'benchmarkId' });
      }
      if (!db.objectStoreNames.contains(STORE_PLAN)) {
        db.createObjectStore(STORE_PLAN, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_GROUPS)) {
        db.createObjectStore(STORE_GROUPS, { keyPath: 'benchmarkId' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function putRuns(runs: readonly Run[]): Promise<void> {
  if (runs.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE_RUNS, 'readwrite');
  const store = tx.objectStore(STORE_RUNS);
  for (const run of runs) store.put(run);
  await txDone(tx);
}

export async function getAllRuns(): Promise<Run[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_RUNS, 'readonly');
  const runs = await requestToPromise(tx.objectStore(STORE_RUNS).getAll() as IDBRequest<Run[]>);
  return runs.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

/** 只取 key，用来判断哪些文件已经导入过，避免重复解析。 */
export async function getImportedFileNames(): Promise<Set<string>> {
  const db = await openDb();
  const tx = db.transaction(STORE_RUNS, 'readonly');
  const keys = await requestToPromise(
    tx.objectStore(STORE_RUNS).getAllKeys() as IDBRequest<IDBValidKey[]>,
  );
  return new Set(keys.map(String));
}

export async function clearRuns(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_RUNS, 'readwrite');
  tx.objectStore(STORE_RUNS).clear();
  await txDone(tx);
}

export async function putBenchmarks(snapshots: readonly BenchmarkSnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE_BENCHMARKS, 'readwrite');
  const store = tx.objectStore(STORE_BENCHMARKS);
  for (const snapshot of snapshots) store.put(snapshot);
  await txDone(tx);
}

export async function getAllBenchmarks(): Promise<BenchmarkSnapshot[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_BENCHMARKS, 'readonly');
  return requestToPromise(
    tx.objectStore(STORE_BENCHMARKS).getAll() as IDBRequest<BenchmarkSnapshot[]>,
  );
}

export async function getAllPlanEntries(): Promise<PlanEntry[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_PLAN, 'readonly');
  return requestToPromise(tx.objectStore(STORE_PLAN).getAll() as IDBRequest<PlanEntry[]>);
}

export async function putPlanEntry(entry: PlanEntry): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PLAN, 'readwrite');
  tx.objectStore(STORE_PLAN).put({ ...entry, key: planKey(entry.day, entry.scenario) });
  await txDone(tx);
}

export async function deletePlanEntry(day: string, scenario: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PLAN, 'readwrite');
  tx.objectStore(STORE_PLAN).delete(planKey(day, scenario));
  await txDone(tx);
}

/**
 * 把某一天的自动条目整批换掉，人工排的条目不动。
 *
 * 读和写分两个事务：IndexedDB 的事务在 await 之后随时可能提交掉，
 * 一个事务里先读后写很容易踩到 TransactionInactiveError。
 */
export async function replaceAutoPlanEntries(
  day: string,
  entries: readonly PlanEntry[],
): Promise<void> {
  const db = await openDb();
  const readTx = db.transaction(STORE_PLAN, 'readonly');
  const all = await requestToPromise(
    readTx.objectStore(STORE_PLAN).getAll() as IDBRequest<PlanEntry[]>,
  );
  const remove = all.filter((entry) => entry.day === day && entry.auto === true);

  const writeTx = db.transaction(STORE_PLAN, 'readwrite');
  const store = writeTx.objectStore(STORE_PLAN);
  for (const entry of remove) store.delete(planKey(entry.day, entry.scenario));
  for (const entry of entries) store.put({ ...entry, key: planKey(entry.day, entry.scenario) });
  await txDone(writeTx);
}

export function planKey(day: string, scenario: string): string {
  return `${day}|${scenario}`;
}

export async function getGrouping(benchmarkId: number): Promise<CategoryGrouping | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_GROUPS, 'readonly');
  const value = await requestToPromise(
    tx.objectStore(STORE_GROUPS).get(benchmarkId) as IDBRequest<CategoryGrouping | undefined>,
  );
  return value ?? null;
}

export async function putGrouping(grouping: CategoryGrouping): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_GROUPS, 'readwrite');
  tx.objectStore(STORE_GROUPS).put(grouping);
  await txDone(tx);
}

export async function deleteGrouping(benchmarkId: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_GROUPS, 'readwrite');
  tx.objectStore(STORE_GROUPS).delete(benchmarkId);
  await txDone(tx);
}

export async function getSettings(): Promise<Settings> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  const value = await requestToPromise(
    tx.objectStore(STORE_META).get(KEY_SETTINGS) as IDBRequest<Partial<Settings> | undefined>,
  );
  return { ...DEFAULT_SETTINGS, ...(value ?? {}) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(settings, KEY_SETTINGS);
  await txDone(tx);
}

export async function getStatsDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  const value = await requestToPromise(
    tx.objectStore(STORE_META).get(KEY_DIR_HANDLE) as IDBRequest<
      FileSystemDirectoryHandle | undefined
    >,
  );
  return value ?? null;
}

export async function saveStatsDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(handle, KEY_DIR_HANDLE);
  await txDone(tx);
}

export async function getTopScores(): Promise<StoredTopScores | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readonly');
  const value = await requestToPromise(
    tx.objectStore(STORE_META).get(KEY_TOP_SCORES) as IDBRequest<StoredTopScores | undefined>,
  );
  return value ?? null;
}

export async function saveTopScores(value: StoredTopScores): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_META, 'readwrite');
  tx.objectStore(STORE_META).put(value, KEY_TOP_SCORES);
  await txDone(tx);
}
