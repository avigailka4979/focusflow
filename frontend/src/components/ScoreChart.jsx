import { LOW_FOCUS_THRESHOLD } from '../util.js';

/** Small dependency-free SVG line chart of scores (0..1) in reading order. */
export default function ScoreChart({ points, height = 160, label = 'גרף ציוני קשב לאורך הסשן' }) {
  const w = 600;
  const h = height;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  if (!points || points.length === 0) return <p className="muted">אין עדיין מדידות להצגה.</p>;
  const x = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (s) => pad.t + (1 - s) * ih;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const yLow = y(LOW_FOCUS_THRESHOLD);

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} preserveAspectRatio="none">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
          <text x={pad.l - 6} y={y(t) + 4} className="chart-axis" textAnchor="end">{t.toFixed(1)}</text>
        </g>
      ))}
      <line x1={pad.l} x2={w - pad.r} y1={yLow} y2={yLow} className="chart-threshold" />
      <text x={w - pad.r} y={yLow - 4} className="chart-axis" textAnchor="end">סף קשב נמוך</text>
      <path d={d} className="chart-line" />
      {points.length <= 60 && points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p)} r="3" className={p < LOW_FOCUS_THRESHOLD ? 'chart-dot low' : 'chart-dot'} />
      ))}
    </svg>
  );
}
