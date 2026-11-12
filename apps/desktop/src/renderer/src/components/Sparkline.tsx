import { useMemo } from 'react';

export function Sparkline({
  data,
  width = 120,
  height = 24,
  stroke = 'var(--accent)',
  fill = 'var(--accent-soft)',
  strokeWidth = 1.5,
  className = '',
}: {
  data: number[];
  width?: number | string;
  height?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  className?: string;
}) {
  const points = useMemo(() => {
    if (!data || data.length === 0) return '';
    const max = Math.max(1, ...data);
    const min = 0;
    const len = data.length;
    const step = len > 1 ? 100 / (len - 1) : 100;

    return data
      .map((val, idx) => {
        const x = idx * step;
        const normalized = (val - min) / (max - min);
        // Invert Y since SVG (0,0) is top-left
        const y = Math.max(2, Math.min(height - 2, height - normalized * (height - 4)));
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [data, height]);

  const areaPolygon = useMemo(() => {
    if (!points) return '';
    const firstX = points.split(' ')[0].split(',')[0];
    const lastX = points.split(' ').slice(-1)[0].split(',')[0];
    return `${firstX},${height} ${points} ${lastX},${height}`;
  }, [points, height]);

  if (!data || data.length < 2) {
    return (
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        style={{ width, height, display: 'block' }}
        className={`sparkline ${className}`}
      >
        <line x1="0" y1={height - 2} x2="100" y2={height - 2} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      style={{ width, height, display: 'block' }}
      className={`sparkline ${className}`}
    >
      {fill && <polygon points={areaPolygon} fill={fill} />}
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
