import type { Run, RunSettings } from './types';

/**
 * 文件名形如：
 *   `Flower Easier - Challenge - 2026.09.19-14.54.26 Stats.csv`
 *   `Air Angelic 4 Voltaic Easy 70% - Challenge - 2026.06.22-11.12.01 Stats.csv`
 *
 * 场景名本身可能含有 ` - `，所以场景名**不能**从文件名里切，要读 CSV 里的 `Scenario:` 字段。
 * 文件名只用来取结束时间。
 */
const FILE_NAME_RE = /(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\s+Stats\.csv$/i;

/** 一行形如 `Key:,Value`。键里不会出现逗号或冒号。 */
const FIELD_RE = /^([^,:\r\n]+):,(.*)$/;

/** 从文件名里取这一局的结束时间；不是 stats 文件则返回 null。 */
export function parseStatsFileName(fileName: string): Date | null {
  const m = FILE_NAME_RE.exec(fileName);
  if (!m) return null;
  const date = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 把 CSV 正文里的 `Key:,Value` 行收成一张表，同名键取第一次出现的。 */
export function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = FIELD_RE.exec(line);
    if (!m) continue;
    const key = m[1]!.trim();
    if (!fields.has(key)) fields.set(key, m[2]!.trim());
  }
  return fields;
}

function toNumber(fields: Map<string, string>, key: string): number | null {
  const raw = fields.get(key);
  if (raw === undefined || raw === '') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/** 保留两位小数，抹掉 float32 的尾巴（例如 139.300003 -> 139.3） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 解析一个 stats 文件。
 * @param text CSV 正文
 * @param fileName 文件名，用来取结束时间
 */
export function parseStatsCsv(text: string, fileName: string): Run | null {
  const endedAt = parseStatsFileName(fileName);
  if (endedAt === null) return null;

  const fields = parseFields(text);

  const scenario = fields.get('Scenario');
  if (!scenario) return null;

  const scoreRaw = toNumber(fields, 'Score');
  if (scoreRaw === null) return null;

  const startRaw = fields.get('Challenge Start');
  if (!startRaw) return null;
  const hms = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(startRaw);
  if (!hms) return null;

  let startedAt = new Date(
    endedAt.getFullYear(),
    endedAt.getMonth(),
    endedAt.getDate(),
    Number(hms[1]),
    Number(hms[2]),
    Number(hms[3]),
  );
  let durationSec = (endedAt.getTime() - startedAt.getTime()) / 1000;
  // 跨午夜的那一局：Challenge Start 是前一天的时间
  if (durationSec < 0) {
    startedAt = new Date(startedAt.getTime() - 86_400_000);
    durationSec += 86_400;
  }

  const sensScale = fields.get('Sens Scale') ?? '';
  const settings: RunSettings = {
    cm360: sensScale.toLowerCase().includes('cm/360') ? toNumber(fields, 'Horiz Sens') : null,
    sensScale,
    dpi: toNumber(fields, 'DPI'),
    fov: toNumber(fields, 'FOV'),
    resolution: fields.get('Resolution') ?? '',
  };

  return {
    scenario,
    startedAt,
    endedAt,
    durationSec,
    score: round2(scoreRaw),
    settings,
    hash: fields.get('Hash') ?? '',
    sourceFile: fileName,
  };
}
