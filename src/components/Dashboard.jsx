import React, { useState } from 'react';
import { Card, Change, Empty } from './ui.jsx';
import { Sparkline } from './Charts.jsx';
import { price, dec, pct, mult } from '../lib/fmt.js';

function IndexCards({ indices }) {
  if (!indices.length) return null;
  return (
    <div className="index-grid">
      {indices.map((i) => (
        <div className="card index-card" key={i.symbol}>
          <div className="row between">
            <span className="muted">{i.name}</span>
            <Sparkline data={i.spark} up={i.chg >= 0} />
          </div>
          <strong className="index-level">{price(i.ltp)}</strong>
          <div className="row gap">
            <Change value={i.chg} />
            <span className="muted small">1W</span> <Change value={i.chg1w} d={1} />
            <span className="muted small">RSI {dec(i.rsi, 0)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Breadth({ b }) {
  const advPct = b.total ? (b.adv / b.total) * 100 : 0;
  const decPct = b.total ? (b.dec / b.total) * 100 : 0;
  const mood = b.above50Pct >= 60 ? 'Broad strength' : b.above50Pct <= 40 ? 'Broad weakness' : 'Mixed market';
  return (
    <Card title="Market breadth" right={<span className="chip">{mood}</span>}>
      <div className="breadth-bar" role="img" aria-label={`${b.adv} advancing, ${b.dec} declining`}>
        <div className="up-bg" style={{ width: `${advPct}%` }} />
        <div className="flat-bg" style={{ width: `${100 - advPct - decPct}%` }} />
        <div className="down-bg" style={{ width: `${decPct}%` }} />
      </div>
      <div className="row between small">
        <span className="up-t">{b.adv} advancing</span>
        <span className="muted">{b.unch} unchanged</span>
        <span className="down-t">{b.dec} declining</span>
      </div>
      <div className="grid-stats two mt">
        <div className="stat"><span>Above 50-day EMA</span><strong>{dec(b.above50Pct, 0)}%</strong></div>
        <div className="stat"><span>Above 200-day EMA</span><strong>{dec(b.above200Pct, 0)}%</strong></div>
        <div className="stat"><span>Average RSI</span><strong>{dec(b.avgRsi)}</strong></div>
        <div className="stat"><span>Setups (bull / bear)</span><strong><span className="up-t">{b.bull}</span> / <span className="down-t">{b.bear}</span></strong></div>
      </div>
    </Card>
  );
}

function MiniList({ title, rows, onOpen, kind }) {
  return (
    <Card title={title}>
      {rows.length ? (
        <ul className="minilist">
          {rows.map((r) => (
            <li key={r.s}>
              <button onClick={() => onOpen(r)}>
                <span className="sym">{r.s}</span>
                <span className="muted small ellipsis">{r.setup || r.sec}</span>
                <Sparkline data={r.spark} width={64} height={22} up={kind !== 'down'} />
                <span className="num">{price(r.ltp)}</span>
                <Change value={r.chg} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing matches the current settings.</Empty>
      )}
    </Card>
  );
}

export const heatColor = (v, scale) => {
  const a = Math.max(0.14, Math.min(0.85, Math.abs(v) / scale));
  return v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
};

function SectorHeatmap({ sectors, onPick, compact = false }) {
  const [metric, setMetric] = useState('chg');
  const labels = { chg: '1D', chg1w: '1W', chg1m: '1M' };
  const values = sectors.map((s) => Math.abs(s[metric]));
  const scale = Math.max(1, ...values) * 0.8;
  const list = [...sectors].sort((a, b) => b[metric] - a[metric]);
  return (
    <Card
      title="Sector heatmap"
      right={
        <div className="seg" role="tablist" aria-label="Heatmap period">
          {Object.entries(labels).map(([k, v]) => (
            <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)} role="tab" aria-selected={metric === k}>
              {v}
            </button>
          ))}
        </div>
      }
    >
      <div className={`heatmap ${compact ? 'compact' : ''}`}>
        {list.map((s) => (
          <button key={s.sector} className="heat-tile" style={{ background: heatColor(s[metric], scale) }} onClick={() => onPick && onPick(s.sector)} title={`${s.count} stocks, ${s.adv} advancing`}>
            <span className="heat-name">{s.sector}</span>
            <strong>{pct(s[metric])}</strong>
            <span className="small">{s.count} {s.count === 1 ? 'stock' : 'stocks'}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function Dashboard({ rows, indices, breadth, sectors, onOpen, onGoScreener }) {
  const bull = rows.filter((r) => r.side === 'BULL').sort((a, b) => b.score - a.score).slice(0, 6);
  const bear = rows.filter((r) => r.side === 'BEAR').sort((a, b) => b.score - a.score).slice(0, 6);
  const gainers = [...rows].sort((a, b) => b.chg - a.chg).slice(0, 6);
  const losers = [...rows].sort((a, b) => a.chg - b.chg).slice(0, 6);
  const volume = [...rows].filter((r) => r.volSpike).sort((a, b) => b.volSpike - a.volSpike).slice(0, 6);
  const near52 = [...rows].filter((r) => r.distHi !== null).sort((a, b) => b.distHi - a.distHi).slice(0, 6);
  return (
    <>
      <IndexCards indices={indices} />
      <div className="grid-2">
        <Breadth b={breadth} />
        <SectorHeatmap sectors={sectors} onPick={onGoScreener} compact />
      </div>
      <div className="grid-2">
        <MiniList title="Top bullish setups" rows={bull} onOpen={onOpen} />
        <MiniList title="Top bearish setups" rows={bear} onOpen={onOpen} kind="down" />
      </div>
      <div className="grid-3">
        <MiniList title="Top gainers (1D)" rows={gainers} onOpen={onOpen} />
        <MiniList title="Top losers (1D)" rows={losers} onOpen={onOpen} kind="down" />
        <Card title="Volume spikes">
          <ul className="minilist">
            {volume.map((r) => (
              <li key={r.s}>
                <button onClick={() => onOpen(r)}>
                  <span className="sym">{r.s}</span>
                  <span className="muted small ellipsis">{r.sec}</span>
                  <Sparkline data={r.spark} width={64} height={22} />
                  <span className="num">{mult(r.volSpike)}</span>
                  <Change value={r.chg} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Closest to 52-week high">
        <ul className="minilist cols">
          {near52.map((r) => (
            <li key={r.s}>
              <button onClick={() => onOpen(r)}>
                <span className="sym">{r.s}</span>
                <span className="muted small ellipsis">{r.sec}</span>
                <span className="num">{price(r.ltp)}</span>
                <Change value={r.distHi} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
