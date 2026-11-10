import React, { useEffect } from 'react';
import { pct, tone } from '../lib/fmt.js';

export function Change({ value, d = 2 }) {
  return <span className={`chg ${tone(value)}`}>{pct(value, d)}</span>;
}

export function Badge({ kind = 'neutral', children }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function SideBadge({ side }) {
  if (side === 'BULL') return <Badge kind="up">BULLISH</Badge>;
  if (side === 'BEAR') return <Badge kind="down">BEARISH</Badge>;
  return <Badge>NEUTRAL</Badge>;
}

export function Card({ title, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="card-head">
          <h2>{title}</h2>
          <div>{right}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({ onClose, children, label }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

// With `side`, the bar is green for a bullish setup, red for bearish and grey for no setup,
// so the score column alone tells the signal on a phone where the Signal column is hidden.
export function ScoreBar({ value, side }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const color =
    side === undefined ? (v >= 75 ? 'var(--up)' : v >= 60 ? 'var(--accent)' : 'var(--muted)') : side === 'BULL' ? 'var(--up)' : side === 'BEAR' ? 'var(--down)' : 'var(--muted)';
  return (
    <div className="scorebar" title={`Score ${v}/100`}>
      <div style={{ width: `${v}%`, background: color }} />
      <span>{v}</span>
    </div>
  );
}
