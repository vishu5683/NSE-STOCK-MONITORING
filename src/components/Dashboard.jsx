import React, { useMemo, useState } from 'react';
import { Card, Change, Empty } from './ui.jsx';
import { Sparkline } from './Charts.jsx';
import { price, dec, pct, mult, compact as short } from '../lib/fmt.js';
import { intradaySignal, orbStatus, participantView, atmStrike } from '../lib/intraday.js';
import { marketPhaseNow } from '../lib/liveApi.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// One-glance market read for the top of the page
function MarketMood({ rows, indices, breadth, meta, intraBuy, intraSell, matched, onGoSheet }) {
  const nifty = indices.find((i) => i.name === 'NIFTY 50');
  const vix = indices.find((i) => i.name === 'INDIA VIX');
  const advPct = breadth.total ? (breadth.adv / breadth.total) * 100 : 50;
  const fii = participantView(meta.participants?.data?.FII);
  let score = 0;
  if (advPct >= 60) score += 1;
  if (advPct <= 40) score -= 1;
  if (isNum(nifty?.chg) && nifty.chg > 0.3) score += 1;
  if (isNum(nifty?.chg) && nifty.chg < -0.3) score -= 1;
  if (isNum(nifty?.vwap) && isNum(nifty?.ltp)) score += nifty.ltp > nifty.vwap ? 1 : -1;
  const mood = score >= 2 ? { label: 'Bullish', icon: '🟢', tone: 'up' } : score <= -2 ? { label: 'Bearish', icon: '🔴', tone: 'down' } : { label: 'Mixed', icon: '🟡', tone: 'warn' };
  const phase = marketPhaseNow(new Date(), null);
  const ban = meta.ban || [];
  return (
    <section className={`card mood mood-${mood.tone}`}>
      <div className="mood-head">
        <div>
          <span className="muted small">{phase.label} · data {meta.lastTradingDate}</span>
          <h2>
            {mood.icon} Market is <span className={`${mood.tone}-t`}>{mood.label}</span>
          </h2>
          <p className="muted small">
            {breadth.adv} up / {breadth.dec} down ({dec(advPct, 0)}% advancing)
            {nifty ? ` · NIFTY ${nifty.chg > 0 ? '+' : ''}${dec(nifty.chg, 2)}%` : ''}
            {isNum(nifty?.vwap) ? ` ${nifty.ltp > nifty.vwap ? 'above' : 'below'} VWAP` : ''}
            {vix ? ` · VIX ${dec(vix.ltp, 1)}` : ''}
          </p>
        </div>
      </div>
      <div className="mood-stats">
        <button onClick={() => onGoSheet('summary')}>
          <span>Settings matched</span>
          <strong>{matched}</strong>
        </button>
        <button onClick={() => onGoSheet('intraday')}>
          <span>Intraday BUY</span>
          <strong className="up-t">{intraBuy}</strong>
        </button>
        <button onClick={() => onGoSheet('intraday')}>
          <span>Intraday SELL</span>
          <strong className="down-t">{intraSell}</strong>
        </button>
        <button onClick={() => onGoSheet('setups')}>
          <span>Setups bull / bear</span>
          <strong>
            <span className="up-t">{breadth.bull}</span> / <span className="down-t">{breadth.bear}</span>
          </strong>
        </button>
        <button onClick={() => onGoSheet('fii')}>
          <span>FII index futures</span>
          <strong className={fii?.idxFutLongPct >= 50 ? 'up-t' : 'down-t'}>{isNum(fii?.idxFutLongPct) ? `${fii.idxFutLongPct}% long` : '-'}</strong>
        </button>
        <button onClick={() => onGoSheet('fno')}>
          <span>F&O ban</span>
          <strong className={ban.length ? 'warn-t' : ''}>{ban.length ? ban.join(', ') : 'None'}</strong>
        </button>
      </div>
    </section>
  );
}

function IndexCards({ indices, onGoSheet }) {
  if (!indices.length) return null;
  return (
    <div className="index-grid">
      {indices.map((i) => {
        const vwapSide = isNum(i.vwap) && isNum(i.ltp) && i.name !== 'INDIA VIX' ? (i.ltp > i.vwap ? 'up' : 'down') : null;
        const atm = i.name !== 'INDIA VIX' ? atmStrike(i.ltp, i.name, i.step) : null;
        return (
          <button className={`card index-card ix-${i.chg >= 0 ? 'up' : 'down'}`} key={i.symbol} onClick={() => i.name !== 'INDIA VIX' && onGoSheet('index')}>
            <div className="row between">
              <span className="ix-name">{i.name}</span>
              <Sparkline data={i.spark} up={i.chg >= 0} />
            </div>
            <strong className="index-level">{price(i.ltp)}</strong>
            <div className="row gap">
              <Change value={i.chg} />
              <span className="muted small">1W</span> <Change value={i.chg1w} d={1} />
            </div>
            <div className="ix-chips">
              {vwapSide && <span className={`ix-chip ${vwapSide}`}>{vwapSide === 'up' ? '▲ above VWAP' : '▼ below VWAP'}</span>}
              {isNum(i.pcr) && <span className="ix-chip">PCR {dec(i.pcr, 2)}</span>}
              {atm && <span className="ix-chip">ATM {atm}</span>}
              {i.name === 'INDIA VIX' && <span className="ix-chip">{i.ltp >= 20 ? 'High volatility' : i.ltp <= 13 ? 'Calm' : 'Normal volatility'}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Breadth({ b }) {
  const advPct = b.total ? (b.adv / b.total) * 100 : 0;
  const decPct = b.total ? (b.dec / b.total) * 100 : 0;
  const mood = b.above50Pct >= 60 ? 'Broad strength' : b.above50Pct <= 40 ? 'Broad weakness' : 'Mixed market';
  return (
    <Card title="📊 Market breadth" right={<span className="chip">{mood}</span>}>
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

const ViewAll = ({ onClick }) => (
  <button className="btn ghost sm view-all" onClick={onClick}>
    View all →
  </button>
);

function MiniList({ title, rows, onOpen, kind, onAll, value }) {
  return (
    <Card title={title} right={onAll && <ViewAll onClick={onAll} />}>
      {rows.length ? (
        <ul className="minilist">
          {rows.map((r) => (
            <li key={r.s}>
              <button onClick={() => onOpen(r)}>
                <span className="sym">{r.s}</span>
                <span className="muted small ellipsis">{r.setup || r.sec}</span>
                <Sparkline data={r.spark} width={64} height={22} up={kind !== 'down'} />
                <span className="num">{value ? value(r) : price(r.ltp)}</span>
                <Change value={r.chg} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing right now.</Empty>
      )}
    </Card>
  );
}

export const heatColor = (v, scale) => {
  const a = Math.max(0.14, Math.min(0.85, Math.abs(v) / scale));
  return v >= 0 ? `rgba(34,197,94,${a})` : `rgba(239,68,68,${a})`;
};

function SectorHeatmap({ sectors, onPick, compact = false, onAll }) {
  const [metric, setMetric] = useState('chg');
  const labels = { chg: '1D', chg1w: '1W', chg1m: '1M' };
  const values = sectors.map((s) => Math.abs(s[metric]));
  const scale = Math.max(1, ...values) * 0.8;
  const all = [...sectors].sort((a, b) => b[metric] - a[metric]);
  const list = compact ? [...all.slice(0, 8), ...all.slice(-4).filter((x) => !all.slice(0, 8).includes(x))] : all;
  return (
    <Card
      title="🗺️ Sector heatmap"
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
      {compact && onAll && (
        <div className="center mt">
          <button className="btn ghost sm" onClick={onAll}>
            All {sectors.length} sectors and every stock →
          </button>
        </div>
      )}
    </Card>
  );
}

export default function Dashboard({ rows, indices, breadth, sectors, onOpen, onGoScreener, onGoSheet, settings, meta }) {
  const c = settings.screener;
  const live = useMemo(() => rows.map((r) => ({ ...r, intra: intradaySignal(r, c), orb: orbStatus(r) })), [rows, c]);
  const bull = rows.filter((r) => r.side === 'BULL').sort((a, b) => b.score - a.score).slice(0, 6);
  const bear = rows.filter((r) => r.side === 'BEAR').sort((a, b) => b.score - a.score).slice(0, 6);
  const gainers = [...rows].sort((a, b) => b.chg - a.chg).slice(0, 6);
  const losers = [...rows].sort((a, b) => a.chg - b.chg).slice(0, 6);
  const volume = [...rows].filter((r) => r.volSpike).sort((a, b) => b.volSpike - a.volSpike).slice(0, 6);
  const near52 = [...rows].filter((r) => r.distHi !== null).sort((a, b) => b.distHi - a.distHi).slice(0, 6);
  const buys = live.filter((r) => r.intra.signal === 'BUY');
  const sells = live.filter((r) => r.intra.signal === 'SELL');
  const intraNow = [...buys, ...sells].sort((a, b) => (b.valueCr ?? 0) - (a.valueCr ?? 0)).slice(0, 6);
  const orbBreaks = live.filter((r) => r.orb.kind === 'up' || r.orb.kind === 'down').sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg)).slice(0, 6);
  const matchedCount = live.filter((r) => (r.side === 'BULL' && r.intra.signal !== 'SELL' && r.intra.signal !== 'NO-TRADE') || (r.side === 'BEAR' && r.intra.signal !== 'BUY' && r.intra.signal !== 'NO-TRADE')).length;
  return (
    <>
      <MarketMood rows={rows} indices={indices} breadth={breadth} meta={meta} intraBuy={buys.length} intraSell={sells.length} matched={matchedCount} onGoSheet={onGoSheet} />
      <IndexCards indices={indices} onGoSheet={onGoSheet} />
      <div className="grid-2">
        <Breadth b={breadth} />
        <SectorHeatmap sectors={sectors} onPick={onGoScreener} compact onAll={() => onGoSheet('heatmap')} />
      </div>
      <div className="grid-2">
        <MiniList title="🚀 Top bullish setups" rows={bull} onOpen={onOpen} onAll={() => onGoSheet('setups')} />
        <MiniList title="🔻 Top bearish setups" rows={bear} onOpen={onOpen} kind="down" onAll={() => onGoSheet('setups')} />
      </div>
      <div className="grid-2">
        <Card title="⚡ Intraday signals now" right={<ViewAll onClick={() => onGoSheet('intraday')} />}>
          {intraNow.length ? (
            <ul className="minilist">
              {intraNow.map((r) => (
                <li key={r.s}>
                  <button onClick={() => onOpen(r)}>
                    <span className="sym">{r.s}</span>
                    <span className={`small ellipsis ${r.intra.signal === 'BUY' ? 'up-t' : 'down-t'}`}>
                      <strong>{r.intra.signal}</strong> {r.intra.option}
                    </span>
                    <Sparkline data={r.spark} width={64} height={22} up={r.intra.signal === 'BUY'} />
                    <span className="num">{price(r.ltp)}</span>
                    <Change value={r.chg} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No intraday BUY or SELL right now.</Empty>
          )}
        </Card>
        <MiniList
          title="🎯 Opening range breakouts"
          rows={orbBreaks}
          onOpen={onOpen}
          onAll={() => onGoSheet('patterns')}
        />
      </div>
      <div className="grid-3">
        <MiniList title="📈 Top gainers" rows={gainers} onOpen={onOpen} onAll={() => onGoSheet('heatmap')} />
        <MiniList title="📉 Top losers" rows={losers} onOpen={onOpen} kind="down" onAll={() => onGoSheet('heatmap')} />
        <MiniList title="🔊 Volume spikes" rows={volume} onOpen={onOpen} value={(r) => mult(r.volSpike)} onAll={() => onGoSheet('active')} />
      </div>
      <Card title="🏔️ Closest to 52-week high" right={<ViewAll onClick={() => onGoSheet('breakout')} />}>
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
      <p className="muted small">Tap any card or stock for details. "View all" opens the matching sheet in Pro Sheet. {short(rows.length)} stocks tracked.</p>
    </>
  );
}
