import { dayKey, type Grain, type SeriesPoint } from '../core/aggregate';
import type { EChartsOption } from 'echarts';

/**
 * 按局、按次训练用序号当 X 轴（第 N 局 / 第 N 次训练），只有按天才用真实日期。
 *
 * 时间轴回答的是「隔了多久」——按天能一眼看出中间停了几周，所以留着。
 * 但一局一局、一次一次的点本来就是挨着练出来的，密度均匀，用时间轴只会把标签
 * 统统渲染成日期，看不出是第几局；中间歇了两周还会空出一段，把趋势压扁。
 */
export function usesOrdinalAxis(grain: Grain): boolean {
  return grain !== 'day';
}

/** 序号轴上的单位词 */
function unitOf(grain: Grain): string {
  return grain === 'session' ? '次训练' : '局';
}

export function xAxisFor(grain: Grain, points: readonly SeriesPoint[]): EChartsOption['xAxis'] {
  if (!usesOrdinalAxis(grain)) return { type: 'time', axisLabel: { hideOverlap: true } };
  const unit = unitOf(grain);
  return {
    type: 'category',
    boundaryGap: false,
    data: points.map((_, index) => `第 ${index + 1} ${unit}`),
    axisLabel: { hideOverlap: true },
  };
}

/** 一条线的数据。序号轴给纯数值（下标就是类别），时间轴给 [时间戳, 值]。 */
export function seriesDataFor(
  grain: Grain,
  points: readonly SeriesPoint[],
  value: (point: SeriesPoint, index: number) => number,
): (number | [number, number])[] {
  return points.map((point, index) =>
    usesOrdinalAxis(grain) ? value(point, index) : [point.t.getTime(), value(point, index)],
  );
}

/** X 轴上是「第 N 局」这种序号，真实时间就挪进 tooltip，顺带报出这个桶里的局数。 */
export function tooltipFor(grain: Grain, points: readonly SeriesPoint[]): EChartsOption['tooltip'] {
  const unit = unitOf(grain);
  return {
    trigger: 'axis',
    formatter: (raw: unknown) => {
      const items = (Array.isArray(raw) ? raw : [raw]) as {
        seriesName?: string;
        dataIndex: number;
        value: unknown;
      }[];
      const first = items[0];
      const point = first === undefined ? undefined : points[first.dataIndex];
      if (!first || !point) return '';
      const lines = [
        usesOrdinalAxis(grain)
          ? `${point.t.toLocaleString('zh-CN')}　第 ${first.dataIndex + 1} ${unit}`
          : `${dayKey(point.t)}　${point.count} 局`,
      ];
      for (const item of items) {
        const value = Array.isArray(item.value) ? item.value[item.value.length - 1] : item.value;
        if (typeof value !== 'number') continue;
        lines.push(`${item.seriesName ?? ''}　${Math.round(value * 100) / 100}`);
      }
      return lines.join('<br/>');
    },
  };
}
