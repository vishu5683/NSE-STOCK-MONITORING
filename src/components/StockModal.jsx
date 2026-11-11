import React from 'react';
import { Modal, Change, SideBadge, ScoreBar } from './ui.jsx';
import { PriceChart, RangeBar } from './Charts.jsx';
import { price, dec, mult, int } from '../lib/fmt.js';
import { weeklyLabel, monthlyLabel, breakoutLabel } from '../lib/signals.js';

const Stat = ({ label, children }) => (
  <div className="stat">
    <span>{label}</span>
    <strong>{children}</strong>
  </div>
);

export default function StockModal({ stock: s, onClose, watched, onToggleWatch }) {
  const plan = s.plan;
  const levels = plan
    ? [
        { label: 'Entry', value: plan.entry, color: 'var(--accent)' },
        { label: 'SL', value: plan.stop, color: 'var(--down)' },
        { label: 'T1', value: plan.t1, color: 'var(--up)' },
        { label: 'T2', value: plan.t2, color: 'var(--up)' },
      ]
    : [];
  return (
    <Modal onClose={onClose} label={`${s.s} details`}>
      <div className="modal-head">
        <div>
          <h2>{s.s}</h2>
          <p className="muted">{s.sec} · {s.live ? 'Live price' : `as of ${s.asOf}`}</p>
        </div>
        <div className="modal-price">
          <strong>₹{price(s.ltp)}</strong>
          <Change value={s.chg} />
        </div>
      </div>

      <div className="row gap">
        <SideBadge side={s.side} />
        {s.setup && <span className="chip">{s.setup}</span>}
        <span className="chip">{s.trend}</span>
        <button className="btn ghost sm" onClick={() => onToggleWatch(s.s)}>
          {watched ? '★ Watching' : '☆ Add to watchlist'}
        </button>
      </div>

      <PriceChart data={s.spark} levels={levels} />

      <div className="grid-stats">
        <Stat label="1W / 1M">
          <Change value={s.chg1w} /> / <Change value={s.chg1m} />
        </Stat>
        <Stat label="Weekly / monthly status">
          {weeklyLabel(s.chg1w)} · {monthlyLabel(s.chg1m)}
        </Stat>
        <Stat label="Open / High / Low">
          {price(s.open)} / {price(s.high)} / {price(s.low)}
        </Stat>
        <Stat label="Prev close">{price(s.prevClose)}</Stat>
        <Stat label="Value traded">₹{dec(s.valueCr, 1)} Cr</Stat>
        <Stat label="Lot size">{s.lot ? int(s.lot) : '-'}</Stat>
        {breakoutLabel(s) && <Stat label="52-week status">{breakoutLabel(s)}</Stat>}
        <Stat label="RSI 14">{dec(s.rsi)}</Stat>
        <Stat label="ADX 14">{dec(s.adx)}</Stat>
        <Stat label="ATR 14">{price(s.atr)}</Stat>
        <Stat label="EMA 20 / 50 / 200">
          {price(s.ema20)} / {price(s.ema50)} / {price(s.ema200)}
        </Stat>
        <Stat label="MACD / signal">
          {dec(s.macd, 2)} / {dec(s.macdSig, 2)}
        </Stat>
        <Stat label="Volume (last session)">{int(s.volume)}</Stat>
        <Stat label="Volume spike vs 20D">{mult(s.volSpike)}</Stat>
        <Stat label="Score (bull / bear)">
          <ScoreBar value={s.score} />
        </Stat>
      </div>

      <div className="range-row">
        <span className="muted">52W low ₹{price(s.lo52)}</span>
        <RangeBar low={s.lo52} high={s.hi52} value={s.ltp} />
        <span className="muted">52W high ₹{price(s.hi52)}</span>
      </div>

      {plan ? (
        <div className="plan">
          <h3>{s.side === 'BULL' ? 'Long' : 'Short'} trade idea (rule-based)</h3>
          <div className="grid-stats">
            <Stat label="Entry">₹{price(plan.entry)}</Stat>
            <Stat label="Stop loss">₹{price(plan.stop)} <span className="muted">({dec(plan.riskPct)}% risk)</span></Stat>
            <Stat label={`Target 1 (${plan.rr1}R)`}>₹{price(plan.t1)}</Stat>
            <Stat label={`Target 2 (${plan.rr2}R)`}>₹{price(plan.t2)}</Stat>
          </div>
          <p className="muted small">Stop loss uses ATR. Levels are a mechanical starting point, not advice. Check position size and your own plan.</p>
        </div>
      ) : (
        <p className="muted small">No setup matches the current screener settings for this stock.</p>
      )}
    </Modal>
  );
}
