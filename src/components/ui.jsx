import React, { useEffect, useRef } from 'react';
import { pct, tone } from '../lib/fmt.js';

export function Change({ value, d = 2 }) {
  return <span className={`chg ${tone(value)}`}>{pct(value, d)}</span>;
}

function Badge({ kind = 'neutral', children }) {
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

// Popup: a fixed top bar (title + close) that never scrolls away, a scrolling body,
// Escape / backdrop / phone Back button / swipe-down on the handle all close it.
export function Modal({ onClose, children, label, title }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const drag = useRef(null);
  const sheet = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // phone Back closes the popup instead of leaving the page
    let poppedByBack = false;
    const onPop = () => {
      if (window.history.state?.nsestocksModal) return; // still on a popup entry (dev double-mount)
      poppedByBack = true;
      closeRef.current();
    };
    try {
      window.history.pushState({ nsestocksModal: true }, '');
      window.addEventListener('popstate', onPop);
    } catch {
      /* history not available */
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = prev;
      if (!poppedByBack && window.history.state?.nsestocksModal) window.history.back();
    };
  }, []);
  const onTouchStart = (e) => {
    drag.current = { y: e.touches[0].clientY, dy: 0 };
  };
  const onTouchMove = (e) => {
    if (!drag.current || !sheet.current) return;
    drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    sheet.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onTouchEnd = () => {
    if (!drag.current || !sheet.current) return;
    const far = drag.current.dy > 90;
    sheet.current.style.transform = '';
    drag.current = null;
    if (far) closeRef.current();
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} ref={sheet}>
        <div className="modal-bar" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <span className="modal-handle" aria-hidden="true" />
          <strong className="modal-title">{title || label}</strong>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
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
