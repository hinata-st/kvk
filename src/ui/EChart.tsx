import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';

/** 和 index.css 里的 --font-sans 保持一致 */
const FONT_STACK = '"Baloo Da 2", "DM Sans", Inter, Roboto, "Segoe UI", system-ui, sans-serif';

/** 极简 ECharts 包装：把 option 塞进去，窗口变化时重绘。 */
export function EChart({
  option,
  height = 320,
  onClick,
}: {
  option: echarts.EChartsOption;
  height?: number;
  onClick?: (params: { name: string; dataIndex: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, 'dark', { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    // 图是 canvas 画的，不会继承页面字体，得自己带一份
    chartRef.current?.setOption({ textStyle: { fontFamily: FONT_STACK }, ...option }, true);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onClick) return;
    const handler = (params: unknown) => onClick(params as { name: string; dataIndex: number });
    chart.on('click', handler);
    return () => {
      chart.off('click', handler);
    };
  }, [onClick]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
