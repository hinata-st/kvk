import { parseStatsCsv, parseStatsFileName } from '../core/parseStatsCsv';
import type { Run } from '../core/types';
import { getImportedFileNames, putRuns } from '../storage/db';

export interface ImportResult {
  /** 目录里认出来的 stats 文件数 */
  scanned: number;
  /** 这次新导入的 */
  imported: number;
  /** 之前已经导入过、这次跳过的 */
  skipped: number;
  /** 解析失败的 */
  failed: number;
}

interface Source {
  name: string;
  read: () => Promise<string>;
}

const WRITE_BATCH = 200;

async function collectFromHandle(handle: FileSystemDirectoryHandle): Promise<Source[]> {
  const sources: Source[] = [];
  // Chrome 的 FileSystemDirectoryHandle 是异步可迭代的，TS 的 dom lib 还没跟上
  const entries = (
    handle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries();
  for await (const [name, entry] of entries) {
    if (entry.kind !== 'file' || parseStatsFileName(name) === null) continue;
    const fileHandle = entry as FileSystemFileHandle;
    sources.push({ name, read: async () => (await fileHandle.getFile()).text() });
  }
  return sources;
}

function collectFromFileList(files: readonly File[]): Source[] {
  const sources: Source[] = [];
  for (const file of files) {
    // webkitdirectory 给出的 name 只有文件名，和 stats 目录里的名字一致
    if (parseStatsFileName(file.name) === null) continue;
    sources.push({ name: file.name, read: () => file.text() });
  }
  return sources;
}

async function importSources(
  sources: readonly Source[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const already = await getImportedFileNames();
  const fresh = sources.filter((s) => !already.has(s.name));
  const result: ImportResult = {
    scanned: sources.length,
    imported: 0,
    skipped: sources.length - fresh.length,
    failed: 0,
  };

  for (let i = 0; i < fresh.length; i += WRITE_BATCH) {
    const batch = fresh.slice(i, i + WRITE_BATCH);
    const parsed = await Promise.all(
      batch.map(async (source) => {
        try {
          return parseStatsCsv(await source.read(), source.name);
        } catch {
          return null;
        }
      }),
    );
    const runs: Run[] = [];
    for (let j = 0; j < parsed.length; j++) {
      const run = parsed[j]!;
      if (run) runs.push(run);
      else result.failed++;
    }
    await putRuns(runs);
    result.imported += runs.length;
    onProgress?.(Math.min(i + WRITE_BATCH, fresh.length), fresh.length);
  }

  return result;
}

/** 从目录句柄导入。只解析还没导入过的文件，所以重复点「刷新」是廉价的。 */
export async function importFromDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  return importSources(await collectFromHandle(handle), onProgress);
}

/** 退路：浏览器不支持目录句柄时，用 <input webkitdirectory> 选一批文件。 */
export async function importFromFileList(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  return importSources(collectFromFileList(files), onProgress);
}
