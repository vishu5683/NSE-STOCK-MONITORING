import React, { useEffect, useState } from 'react';
import { Modal, Change, SideBadge, ScoreBar } from './ui.jsx';
import { PriceChart, RangeBar, CandleChart } from './Charts.jsx';
import { fetchCandles, fetchDepth, marketOpenNow } from '../lib/liveApi.js';
import { price, dec, mult, int } from '../lib/fmt.js';
import { weeklyLabel, monthlyLabel, breakoutLabel } from '../lib/signals.js';
import { pivots, orbStatus, pdStatus, gapLabel, patternTags, pcrSentiment, atmFor } from '../lib/intraday.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Support / resistance ladder sorted by price, with the live price slotted in
function Levels({ s }) {
  const pv = pivots(s);
  const raw = [
    pv && ['R3', pv.R3, 'r'], pv && ['R2', pv.R2, 'r'], pv && ['R1', pv.R1, 'r'], pv && ['Pivot', pv.P, ''], pv && ['S1', pv.S1, 's'], pv && ['S2', pv.S2, 's'], pv && ['S3', pv.S3, 's'],
    ['Prev high', s.pdh, 'r'], ['Prev low', s.pdl, 's'], ['ORB high', s.orbHigh, 'r'], ['ORB low', s.orbLow, 's'], ['VWAP', s.vwap, ''],
    ['CPR top', s.cprTc, ''], ['CPR bottom', s.cprBc, ''], ['Call OI wall', s.callOiRes, 'r'], ['Put OI wall', s.putOiSup, 's'], ['Max pain', s.maxPain, ''],
  ].filter((x) => x && isNum(x[1]));
  if (!raw.length) return null;
  const list = [...raw, ['LIVE', s.ltp, 'now']].sort((a, b) => b[1] - a[1]);
  return (
    <div className="plan">
      <h3>Key levels (high to low)</h3>
      <div className="levels-grid">
        {list.map(([k, v, cls]) => (
          <div key={k} className={`lvl ${cls}`}>
            <span>{k}</span>
            <strong>{price(v)}</strong>
          </div>
        ))}
      </div>
      <p className="muted small">Pivots and previous high / low are from the last session. OI walls and max pain: {s.oiLive ? 'live Upstox option chain' : 'NSE end-of-day'}.</p>
    </div>
  );
}

const Stat = ({ label, children }) => (
  <div className="stat">
    <span>{label}</span>
    <strong>{children}</strong>
  </div>
);

// Today's candles, refreshed every minute while the popup is open and the market is open
function useCandles(symbol) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let off = false;
    let timer = null;
    const load = async () => {
      const d = await fetchCandles(symbol);
      if (off) return;
      if (d) setData(d);
      if (marketOpenNow()) timer = setTimeout(load, 60000);
    };
    load();
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [symbol]);
  return data;
}

// 5-level order book, refreshed every 5 s while the popup is open in market hours
function useDepth(symbol) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let off = false;
    let timer = null;
    const load = async () => {
      const x = await fetchDepth(symbol);
      if (off) return;
      if (x) setD(x);
      if (marketOpenNow()) timer = setTimeout(load, 5000);
    };
    load();
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [symbol]);
  return d;
}

function OrderBook({ d }) {
  if (!d || (!d.buy.length && !d.sell.length)) return null;
  const max = Math.max(1, ...d.buy.map((x) => x[1]), ...d.sell.map((x) => x[1]));
  const tb = d.totalBuy || 0;
  const ts = d.totalSell || 0;
  const buyPct = tb + ts ? Math.round((tb / (tb + ts)) * 100) : null;
  return (
    <div className="plan orderbook">
      <h3>Order book (live)</h3>
      <div className="ob-grid">
        <div>
          <div className="ob-head"><span>Bid qty</span><span>Bid</span></div>
          {d.buy.map(([p, q], i) => (
            <div className="ob-row buy" key={`b${i}`}>
              <i style={{ width: `${(q / max) * 100}%` }} />
              <span>{int(q)}</span>
              <strong>{price(p)}</strong>
            </div>
          ))}
        </div>
        <div>
          <div className="ob-head"><span>Ask</span><span>Ask qty</span></div>
          {d.sell.map(([p, q], i) => (
            <div className="ob-row sell" key={`s${i}`}>
              <i style={{ width: `${(q / max) * 100}%` }} />
              <strong>{price(p)}</strong>
              <span>{int(q)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid-stats">
        {buyPct !== null && (
          <div className="stat">
            <span>Total buy vs sell qty</span>
            <strong className={buyPct >= 50 ? 'up-t' : 'down-t'}>{buyPct}% buyers</strong>
          </div>
        )}
        {isNum(d.avgPrice) && <div className="stat"><span>Average traded price</span><strong>₹{price(d.avgPrice)}</strong></div>}
        {isNum(d.upperCircuit) && <div className="stat"><span>Circuit (low / high)</span><strong>{price(d.lowerCircuit)} / {price(d.upperCircuit)}</strong></div>}
      </div>
    </div>
  );
}

export default function StockModal({ stock: s, onClose, watched, onToggleWatch }) {
  const depth = useDepth(s.s);
  const plan = s.plan;
  const candles = useCandles(s.s);
  const [view, setView] = useState('today');
  const [wide] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 681px)').matches);
  const showToday = view === 'today' && candles?.bars?.length > 1;
  const dayLevels = [
    { label: 'ORB H', value: s.orbHigh, color: 'var(--up)' },
    { label: 'ORB L', value: s.orbLow, color: 'var(--down)' },
    { label: 'PDH', value: s.pdh, color: 'var(--muted)' },
    { label: 'PDL', value: s.pdl, color: 'var(--muted)' },
    ...(plan ? [{ label: 'SL', value: plan.stop, color: 'var(--down)' }, { label: 'T1', value: plan.t1, color: 'var(--up)' }] : []),
  ];
  const levels = plan
    ? [
        { label: 'Entry', value: plan.entry, color: 'var(--accent)' },
        { label: 'SL', value: plan.stop, color: 'var(--down)' },
        { label: 'T1', value: plan.t1, color: 'var(--up)' },
        { label: 'T2', value: plan.t2, color: 'var(--up)' },
      ]
    : [];
  return (
    <Modal onClose={onClose} label={`${s.s} details`} title={`${s.s} · ₹${price(s.ltp)} · ${isNum(s.chg) ? `${s.chg > 0 ? '+' : ''}${s.chg.toFixed(2)}%` : ''}`}>
      <div className="modal-head">
        <div>
          <h2>
            {s.s} {s.inBan && <span className="ban-chip">F&O BAN</span>}
          </h2>
          <p className="muted">
            {s.name ? `${s.name} · ` : ''}
            {s.sec} · {s.live ? 'Live price' : `as of ${s.asOf}`}
          </p>
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

      {candles?.bars?.length > 1 && (
        <div className="seg chart-toggle" role="tablist" aria-label="Chart period">
          <button className={view === 'today' ? 'on' : ''} onClick={() => setView('today')} role="tab" aria-selected={view === 'today'}>
            Today 5-min
          </button>
          <button className={view === '60d' ? 'on' : ''} onClick={() => setView('60d')} role="tab" aria-selected={view === '60d'}>
            60 days
          </button>
        </div>
      )}
      {showToday ? (
        <>
          <CandleChart bars={candles.bars} levels={dayLevels} cpr={isNum(s.cprBc) ? { bc: s.cprBc, tc: s.cprTc } : null} />
          <p className="muted small chart-legend">
            Candles {candles.day} · blue line = VWAP{candles.vwapProxy ? ' (no volume, average price)' : ''} {isNum(candles.bars.at(-1)[6]) ? price(candles.bars.at(-1)[6]) : ''} · shaded band = CPR · ORB = first 15 min · PDH / PDL = previous day
          </p>
        </>
      ) : (
        <PriceChart data={s.spark} levels={levels} />
      )}

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

      <OrderBook d={depth} />

      <Levels s={s} />

      <div className="range-row">
        <span className="muted">52W low ₹{price(s.lo52)}</span>
        <RangeBar low={s.lo52} high={s.hi52} value={s.ltp} />
        <span className="muted">52W high ₹{price(s.hi52)}</span>
      </div>

      <details className="more-stats" open={wide}>
        <summary>All indicators</summary>
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
        {isNum(s.delivPct) && <Stat label="Delivery % (NSE)">{dec(s.delivPct, 1)}%</Stat>}
        {isNum(s.mwplPct) && (
          <Stat label="MWPL used">
            {dec(s.mwplPct, 1)}% {s.inBan ? <span className="ban-chip">BAN</span> : s.mwplPct >= 80 ? <span className="warn-t">near ban</span> : null}
          </Stat>
        )}
        {isNum(s.pcr) && <Stat label={`PCR (${s.oiLive ? 'live' : 'EOD'})`}>{pcrSentiment(s.pcr).label}</Stat>}
        {s.futBuildup && <Stat label={`Futures build-up (${s.oiLive ? 'live' : 'EOD'})`}>{s.futBuildup}</Stat>}
        {isNum(s.iv) && <Stat label={`ATM IV (${s.oiLive ? 'live' : 'EOD'})`}>{dec(s.iv, 1)}%</Stat>}
        {isNum(s.orbHigh) && <Stat label="Opening range (15 min)">{orbStatus(s).label}</Stat>}
        {isNum(s.pdh) && <Stat label="Vs previous day">{pdStatus(s).label}</Stat>}
        {isNum(s.dayOpen) && <Stat label="Open">{gapLabel(s).label}</Stat>}
        {patternTags(s).length > 0 && <Stat label="Patterns">{patternTags(s).join(' · ')}</Stat>}
        {isNum(s.ltp) && <Stat label="ATM strike">{atmFor(s)}</Stat>}
        <Stat label="Score (bull / bear)">
          <ScoreBar value={s.score} />
        </Stat>
      </div>
      </details>
    </Modal>
  );
}
