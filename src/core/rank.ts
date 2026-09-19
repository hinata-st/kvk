/**
 * 段位判定。
 *
 * 规则与官方一致：从最大的阈值往下找，第一个满足「分数 >= 阈值」的下标 i，
 * 段位就是 i + 1；一个都不满足则段位为 0（未定级）。
 *
 * 重要：传进来的分数必须是**本地单位**（游戏内显示值），因为 rankMaxes 用的就是这套单位。
 * 官方 API 返回的 score 是本地单位的 100 倍，必须先除以 100。见 docs/adr/0002-score-unit-100x.md
 */
export function rankForScore(score: number, rankMaxes: readonly number[]): number {
  for (let i = rankMaxes.length - 1; i >= 0; i--) {
    if (score >= rankMaxes[i]!) return i + 1;
  }
  return 0;
}

/** 最高等级的阈值（阈值数组的最后一个）。分数达到它即满级。 */
export function topThreshold(rankMaxes: readonly number[]): number | null {
  if (rankMaxes.length === 0) return null;
  const top = rankMaxes[rankMaxes.length - 1]!;
  return top > 0 ? top : null;
}

/**
 * 归一化分数：相对最高等级阈值的百分比。
 * 100% 表示摸到了最高等级的阈值，>100% 表示超出（有可能，阈值不是上限）。
 */
export function normalizedScore(score: number, rankMaxes: readonly number[]): number | null {
  const top = topThreshold(rankMaxes);
  if (top === null) return null;
  return (score / top) * 100;
}

/**
 * 段位进度：整数部分是已达段位，小数部分是往下一段位走了多少。
 *
 * 雷达图每根轴问的是「你现在在哪一级」，需要连续值——同一张图上 4.2 和 4.8 得画得出来，
 * 光用 rankForScore 的话它们都是 4，会长成一模一样。上限就是段位总数（顶到最高段位）。
 * 没有阈值（官方没给）时返回 null，调用方自己决定是跳过还是当 0。
 */
export function rankProgress(score: number, rankMaxes: readonly number[]): number | null {
  const first = rankMaxes[0];
  if (first === undefined || first <= 0) return null;
  // 连第一段的门槛都没到，就按「从圆心走到第一环」的比例算
  if (score < first) return Math.max(0, score / first);
  for (let i = rankMaxes.length - 1; i >= 0; i--) {
    const lower = rankMaxes[i]!;
    if (score < lower) continue;
    const next = rankMaxes[i + 1];
    // 已经是最高段位，没有下一格可以量进度
    if (next === undefined || next <= lower) return i + 1;
    return i + 1 + (score - lower) / (next - lower);
  }
  return 0;
}

/** 距离目标等级还差多少分。已经达到或超过则返回 0。 */
export function pointsToTarget(
  score: number,
  rankMaxes: readonly number[],
  targetRank: number,
): number | null {
  if (targetRank <= 0) return 0;
  const threshold = rankMaxes[targetRank - 1];
  if (threshold === undefined) return null;
  return Math.max(0, threshold - score);
}
