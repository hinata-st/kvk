/**
 * 曲线首尾的变化百分比。绿涨红跌，只有一个点（没得比）时什么都不画。
 */
export function ChangeBadge({ pct, title }: { pct: number | null; title?: string }) {
  if (pct === null) return null;
  const rounded = Math.round(pct * 10) / 10;
  const tone = rounded > 0 ? 'text-emerald-400' : rounded < 0 ? 'text-rose-400' : 'text-slate-500';
  return (
    <span
      className={`shrink-0 font-mono text-xs whitespace-nowrap ${tone}`}
      title={title ?? '这条曲线第一个点到最后一个点的变化'}
    >
      {`${rounded > 0 ? '+' : ''}${rounded}%`}
    </span>
  );
}
