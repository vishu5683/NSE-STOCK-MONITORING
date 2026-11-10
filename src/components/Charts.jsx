import React from 'react';

export function Sparkline({ data, up, width = 96, height = 28 }) {
  const pts = (data || []).filter((x) => typeof x === 'number');
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - 2 - ((p - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const color = up === undefined ? (pts[pts.length - 1] >= pts[0] ? 'var(--up)' : 'var(--down)') : up ? 'var(--up)' : 'var(--down)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// 60-session price line with optional trade-plan levels.
export function PriceChart({ data, levels = [], height = 220 }) {
  const pts = (data || []).filter((x) => typeof x === 'number');
  if (pts.length < 2) return null;
  const W = 640;
  const padL = 8;
  const padR = 64;
  const padT = 12;
  const padB = 20;
  const all = [...pts, ...levels.map((l) => l.value).filter((v) => typeof v === 'number')];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / span) * (height - padT - padB);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${height - padB} L${x(0).toFixed(1)},${height - padB} Z`;
  const up = pts[pts.length - 1] >= pts[0];
  const color = up ? 'var(--up)' : 'var(--down)';
  return (
    <svg className="price-chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Price chart, last 60 sessions">
      <defs>
        <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padR} y1={padT + t * (height - padT - padB)} y2={padT + t * (height - padT - padB)} stroke="var(--line)" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="url(#pc-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {levels.map((l) =>
        typeof l.value === 'number' ? (
          <g key={l.label}>
            <line x1={padL} x2={W - padR} y1={y(l.value)} y2={y(l.value)} stroke={l.color} strokeDasharray="5 4" strokeWidth="1.2" opacity="0.9" />
            <text x={W - padR + 6} y={y(l.value) + 4} fontSize="11" fill={l.color} fontWeight="600">
              {l.label}
            </text>
          </g>
        ) : null,
      )}
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="4" fill={color} />
      <text x={padL} y={height - 4} fontSize="10" fill="var(--muted)">
        60 sessions ago
      </text>
      <text x={W - padR} y={height - 4} fontSize="10" fill="var(--muted)" textAnchor="end">
        latest
      </text>
    </svg>
  );
}

// Position of price inside the 52-week range.
export function RangeBar({ low, high, value }) {
  if (![low, high, value].every((v) => typeof v === 'number') || high <= low) return null;
  const p = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return (
    <div className="rangebar" title={`52W low ${low} - high ${high}`}>
      <div className="rangebar-track">
        <div className="rangebar-fill" style={{ width: `${p}%` }} />
        <div className="rangebar-dot" style={{ left: `${p}%` }} />
      </div>
    </div>
  );
}
