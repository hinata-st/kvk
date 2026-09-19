/**
 * 解析 KovaaK's 的 `TopScores.sav`。
 *
 * 这个文件是游戏的**个人最高分缓存**，UE4 的 GVAS 格式，位置在
 * `%LOCALAPPDATA%\FPSAimTrainer\Saved\SaveGames\<steamid>\TopScores.sav`。
 *
 * 为什么需要它：stats 目录只保留你还留在磁盘上的那批逐局文件，更早的成绩会被清掉。
 * 于是会出现「某个场景本地一局都没有、但官方其实有分」的情况，界面就会把它显示成
 * 0 分 / 未定级，候选池和进度都跟着失真。TopScores.sav 里存的是每个场景的个人最高分，
 * 正好补上这一段。实测它与官方接口返回的 score 一致（本地单位，不乘 100）。
 *
 * 结构（每条记录）：
 *   ScenarioName (StrProperty) -> 场景名
 *   Score        (FloatProperty) -> 个人最高分
 *   bIsAccuracyValue / AccuracyOrDamageEfficientcy / ScenarioHash
 *
 * 这里不写完整的 GVAS 解析器，只按这个固定布局取数——**取不到就抛错**，
 * 宁可让用户看见「格式变了」，也不要静默塞进一堆 0 分。
 */
export interface TopScoreEntry {
  scenario: string;
  score: number;
}

/** `Score` 的属性和类型名连在一起，出现在值时前面 */
const SCORE_MARKER = 'Score\x00\x0e\x00\x00\x00FloatProperty\x00';
/** 属性头之后的布局：size(4) + 5 字节固定填充，然后才是 4 字节浮点 */
const SCORE_VALUE_OFFSET = 9;
/** 紧随分数之后的属性名长度（"bIsAccuracyValue" + 结尾的 \0 = 17），用来确认没读错位置 */
const NEXT_PROPERTY_LENGTH = 0x11;
const NEXT_PROPERTY_OFFSET = SCORE_VALUE_OFFSET + 4;

const MAX_PLAUSIBLE_SCORE = 1e7;

function latin1(bytes: Uint8Array): string {
  // latin1 下「字符下标 == 字节下标」，所以字符串里找到的位置可以直接当偏移用
  return new TextDecoder('latin1').decode(bytes);
}

export function parseTopScores(input: ArrayBuffer | Uint8Array): TopScoreEntry[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const text = latin1(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const entries: TopScoreEntry[] = [];
  const seen = new Set<string>();

  // 场景名紧跟在 ScenarioName 这个 StrProperty 的头部之后
  const namePattern = /ScenarioName\x00[\s\S]{0,40}?StrProperty\x00[\s\S]{0,24}?([\x20-\x7e]{3,160})\x00/g;
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(text)) !== null) {
    const scenario = match[1]!;
    const scoreAt = text.indexOf(SCORE_MARKER, namePattern.lastIndex);
    if (scoreAt < 0) continue;
    const valueAt = scoreAt + SCORE_MARKER.length;

    if (view.getUint32(valueAt + NEXT_PROPERTY_OFFSET, true) !== NEXT_PROPERTY_LENGTH) {
      throw new Error(
        `TopScores.sav 的结构和预期不一样（场景「${scenario}」后面没找到 bIsAccuracyValue）。` +
          '游戏更新过的话，解析要跟着改。',
      );
    }

    const raw = view.getFloat32(valueAt + SCORE_VALUE_OFFSET, true);
    // float32 会带一串噪声出来（95.0011978149414），而游戏本身只显示两位小数
    const score = Math.round(raw * 100) / 100;
    if (!Number.isFinite(score) || score < 0 || score > MAX_PLAUSIBLE_SCORE) {
      throw new Error(`场景「${scenario}」的分数读出来是 ${raw}，不像是分数。`);
    }
    if (seen.has(scenario)) continue;
    seen.add(scenario);
    entries.push({ scenario, score });
  }

  if (entries.length === 0) {
    throw new Error('一个场景都没解析出来，这大概不是 TopScores.sav。');
  }
  return entries;
}
