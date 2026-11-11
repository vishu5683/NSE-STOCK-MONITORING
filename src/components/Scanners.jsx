import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Change, Empty, Modal, ScoreBar } from './ui.jsx';
import { heatColor } from './Dashboard.jsx';
import { price, dec, mult, compact, int, pct } from '../lib/fmt.js';
import { convictionLabel, weeklyLabel, monthlyLabel, breakoutLabel } from '../lib/signals.js';
import {
  atmFor,
  atmStrike,
  rsiStatus,
  adxStatus,
  macdStatus,
  cprLabel,
  intradaySignal,
  settingsMatch,
  breakoutSignal,
  swingSignal,
  swingTrend,
  indexSignal,
  pcrSentiment,
  todayLabel,
  buildupTone,
  gapLabel,
  gapPct,
  orbStatus,
  pdStatus,
  rangeBreak20,
  patternTags,
  breakScore,
  participantView,
} from '../lib/intraday.js';
import { exportTable } from '../lib/exporters.js';

// Same tabs, same order as the client's Google Sheet.
const VIEWS = [
  { id: 'setups', label: 'Profitable Setups' },
  { id: 'summary', label: 'Dashboard' },
  { id: 'active', label: 'Most Active' },
  { id: 'index', label: 'Index Options' },
  { id: 'fno', label: 'F&O Screener' },
  { id: 'chain', label: 'Option Chain' },
  { id: 'futures', label: 'Futures Data' },
  { id: 'breakout', label: 'Breakout' },
  { id: 'swing', label: 'Swing' },
  { id: 'heatmap', label: 'Sector Heatmap' },
  { id: 'intraday', label: 'Intraday' },
  { id: 'patterns', label: 'Patterns & ORB' },
  { id: 'fii', label: 'FII / DII' },
];
const VIEW_KEY = 'nsestocks.scanView';
const ALERT_KEY = 'nsestocks.alerts';
const readFlag = (k) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};

// What a stock is "doing" right now; an alert fires when this changes into something tradable.
const alertState = (r) => ({ match: r.match.tone === 'up' || r.match.tone === 'down' ? r.match.label : '', sig: r.intra.signal, orb: orbStatus(r).kind });

function alertEvents(prev, r) {
  const now = alertState(r);
  const out = [];
  if (now.match && now.match !== prev.match) out.push({ text: `${r.s}: ${now.match}`, tone: r.match.tone });
  if ((now.sig === 'BUY' || now.sig === 'SELL') && now.sig !== prev.sig) out.push({ text: `${r.s}: intraday ${sigText(r.intra)} at ${price(r.ltp)}`, tone: now.sig === 'BUY' ? 'up' : 'down' });
  if ((now.orb === 'up' || now.orb === 'down') && now.orb !== prev.orb && prev.orb === 'inside') out.push({ text: `${r.s}: ${orbStatus(r).label}`, tone: now.orb });
  return out;
}
const has = (x) => typeof x === 'number' && Number.isFinite(x);

const toneClass = (t) => (t === 'up' ? 'up-t' : t === 'down' ? 'down-t' : t === 'warn' ? 'warn-t' : 'muted');
const Tag = ({ v }) => <span className={`tag ${toneClass(v.tone)}`}>{v.label}</span>;
const sigTone = (s) => (s === 'BUY' ? 'up' : s === 'SELL' ? 'down' : s === 'NO-TRADE' ? 'warn' : 'flat');
const sigText = (x) => (x.option ? `${x.signal} (${x.option})` : x.signal === 'NO-TRADE' ? `NO-TRADE (${x.reason})` : x.signal);

// Price that flashes green / red when a live tick moves it.
function Tick({ value, d = 2 }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (has(prev.current) && has(value) && value !== prev.current) {
      setFlash(value > prev.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 900);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
    return undefined;
  }, [value]);
  return <span className={`tick ${flash}`}>{d === 2 ? price(value) : dec(value, d)}</span>;
}

function SignalCell({ intra }) {
  return (
    <span className={`tag ${toneClass(sigTone(intra.signal))}`} title={intra.reason}>
      {sigText(intra)}
      {intra.plan && <small className="muted"> · SL {price(intra.plan.stop)} · T1 {price(intra.plan.t1)}</small>}
    </span>
  );
}

// Sortable table. col: { label, cell(r), x(r) for sort + export, sort?: false, hide?, cls?, str? }
function Grid({ rows, cols, initialSort, onOpen, empty, title, ctx }) {
  const [sort, setSort] = useState(initialSort || null);
  const [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false);
  useEffect(() => setLimit(60), [rows.length]);
  const list = useMemo(() => {
    if (!sort) return rows;
    const col = cols[sort.i];
    if (!col || col.sort === false) return rows;
    return [...rows].sort((a, b) => {
      const x = col.x(a);
      const y = col.x(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (col.str ? String(x).localeCompare(String(y)) : x - y) * sort.dir;
    });
  }, [rows, cols, sort]);
  const doExport = async () => {
    setBusy(true);
    try {
      await exportTable({ title, cols, rows: list, meta: ctx.meta, settings: ctx.settings });
    } finally {
      setBusy(false);
    }
  };
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <>
      <div className="grid-tools">
        <span className="muted small">{rows.length} rows</span>
        <button className="btn ghost sm" onClick={doExport} disabled={busy}>
          {busy ? 'Preparing…' : '⬇ Excel (this tab)'}
        </button>
      </div>
      <div className="table-wrap sheet-wrap">
        <table className="table">
          <thead>
            <tr>
              {cols.map((c, i) => {
                const on = sort?.i === i;
                const can = c.sort !== false;
                const cls = `${can ? 'sortable' : ''} ${c.hide ? `hide-${c.hide}` : ''} ${c.freeze ? 'freeze' : ''}`;
                return (
                  <th
                    key={c.label}
                    className={cls}
                    onClick={can ? () => setSort({ i, dir: on ? -sort.dir : c.str ? 1 : -1 }) : undefined}
                    aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.label} {on ? (sort.dir === 1 ? '▲' : '▼') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r) => (
              <tr key={r.s || r.name} tabIndex={onOpen ? 0 : undefined} onClick={onOpen ? () => onOpen(r) : undefined} onKeyDown={onOpen ? (e) => e.key === 'Enter' && onOpen(r) : undefined}>
                {cols.map((c) => (
                  <td key={c.label} className={`${c.hide ? `hide-${c.hide}` : ''} ${c.cls || ''} ${c.freeze ? 'freeze' : ''}`}>
                    {c.cell ? c.cell(r) : c.x(r) ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {list.length > limit && (
          <div className="center mt">
            <button className="btn ghost" onClick={() => setLimit(limit + 60)}>
              Show more ({list.length - limit} left)
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// shared columns
const SYM = {
  label: 'Symbol',
  x: (r) => r.s,
  cell: (r) => (
    <strong className="sym">
      {r.s}
      {r.inBan && <span className="ban-chip" title="In the NSE F&O ban period: no fresh positions">BAN</span>}
    </strong>
  ),
  str: true,
  freeze: true,
};
// symbol with a rank in front (Setups, Most Active), still the frozen column
const rankSym = (rankOf) => ({
  ...SYM,
  label: 'Symbol',
  cell: (r) => (
    <strong className="sym">
      <em className="rank">#{rankOf(r)}</em>
      {r.s}
      {r.inBan && <span className="ban-chip">BAN</span>}
    </strong>
  ),
});
const DELIV = { label: 'Delivery %', x: (r) => r.delivPct, cell: (r) => <span className={r.delivPct >= 60 ? 'up-t' : r.delivPct < 25 ? 'muted' : ''}>{dec(r.delivPct, 1)}</span>, cls: 'num', hide: 'md' };
const MWPL = { label: 'MWPL %', x: (r) => r.mwplPct, cell: (r) => <span className={r.mwplPct >= 80 ? 'warn-t' : ''} title="Market-wide position limit used. 95% puts the stock in the F&O ban.">{dec(r.mwplPct, 1)}</span>, cls: 'num', hide: 'sm' };
const NAME = { label: 'Company', x: (r) => r.name || '', cell: (r) => <span className="muted small ellipsis-cell">{r.name || '-'}</span>, str: true, hide: 'md' };
const SEC = { label: 'Sector', x: (r) => r.sec, cell: (r) => <span className="muted">{r.sec}</span>, str: true, hide: 'md' };
const LTP = { label: 'LTP', x: (r) => r.ltp, cell: (r) => <Tick value={r.ltp} />, cls: 'num' };
const CHG = { label: 'Chg %', x: (r) => r.chg, cell: (r) => <Change value={r.chg} /> };
const MATCH = { label: 'Settings Match', x: (r) => r.match.label, cell: (r) => <Tag v={r.match} />, str: true };
const LOT = { label: 'Lot', x: (r) => r.lot, cell: (r) => int(r.lot), cls: 'num', hide: 'md' };

export default function Scanners({ rows, indices, sectors, settings, onOpen, onSector, meta }) {
  const [view, setView] = useState(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      return VIEWS.some((x) => x.id === v) ? v : 'setups';
    } catch {
      return 'setups';
    }
  });
  const [q, setQ] = useState('');
  const [chainOf, setChainOf] = useState(null);
  const [alertsOn, setAlertsOn] = useState(() => readFlag(ALERT_KEY));
  const [toasts, setToasts] = useState([]);
  const lastState = useRef(null);
  const c = settings.screener;
  const ctx = { meta, settings };

  const tabsRef = useRef(null);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
    // phones: keep the chosen sheet tab visible in the scrolling tab strip
    const on = tabsRef.current?.querySelector('button.on');
    if (on && tabsRef.current.scrollWidth > tabsRef.current.clientWidth) {
      tabsRef.current.scrollTo({ left: on.offsetLeft - (tabsRef.current.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
    }
  }, [view]);

  // one pass: every tab reads from the same enriched row
  const enriched = useMemo(() => {
    const byTurnover = [...rows].sort((a, b) => (b.valueCr ?? -1) - (a.valueCr ?? -1)).map((r) => r.s);
    const turnRank = new Map(byTurnover.map((s, i) => [s, i + 1]));
    return rows.map((r) => {
      const intra = intradaySignal(r, c);
      return { ...r, intra, match: settingsMatch(r, intra), brk: breakoutSignal(r, c), swing: swingSignal(r, c), atm: atmFor(r), turnRank: turnRank.get(r.s) };
    });
  }, [rows, c]);
  // Alerts: compare each refresh / live tick with the previous one
  useEffect(() => {
    const next = new Map(enriched.map((r) => [r.s, alertState(r)]));
    const prev = lastState.current;
    lastState.current = next;
    if (!alertsOn || !prev) return;
    const events = enriched.flatMap((r) => (prev.has(r.s) ? alertEvents(prev.get(r.s), r) : [])).slice(0, 6);
    if (!events.length) return;
    const stamp = Date.now();
    setToasts((t) => [...events.map((e, i) => ({ ...e, id: `${stamp}-${i}` })), ...t].slice(0, 5));
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`${settings.clientName}: ${events.length} new signal${events.length > 1 ? 's' : ''}`, { body: events.map((e) => e.text).join('\n'), tag: 'nsestocks-signal' });
      }
    } catch {
      /* some mobile browsers only allow notifications from a service worker */
    }
  }, [enriched, alertsOn, settings.clientName]);
  useEffect(() => {
    if (!toasts.length) return undefined;
    const t = setTimeout(() => setToasts((x) => x.slice(0, -1)), 12000);
    return () => clearTimeout(t);
  }, [toasts]);
  const toggleAlerts = async () => {
    const on = !alertsOn;
    if (on && 'Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* toasts still work */
      }
    }
    try {
      localStorage.setItem(ALERT_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    setAlertsOn(on);
  };

  const needle = q.trim().toUpperCase();
  const shown = needle
    ? enriched.filter((r) => r.s.includes(needle) || (r.sec || '').toUpperCase().includes(needle) || (r.name || '').toUpperCase().includes(needle))
    : enriched;
  const fno = shown.filter((r) => has(r.futOi) || has(r.pcr));

  const matched = enriched.filter((r) => r.match.tone === 'up' || r.match.tone === 'down');
  const stats = {
    matched: matched.length,
    buy: enriched.filter((r) => r.intra.signal === 'BUY').length,
    sell: enriched.filter((r) => r.intra.signal === 'SELL').length,
    noTrade: enriched.filter((r) => r.intra.signal === 'NO-TRADE').length,
    intra: enriched.filter((r) => r.intra.signal !== 'NO DATA').length,
    fno: enriched.filter((r) => has(r.futOi)).length,
    lastBar: enriched.map((r) => r.iAsOf).filter(Boolean).sort().pop(),
  };
  const eod = meta.foDate ? `NSE end-of-day ${meta.foDate}` : 'not loaded';

  return (
    <>
      <div className="grid-stats scan-stats">
        <div className="stat"><span>Settings matched</span><strong>{stats.matched}</strong></div>
        <div className="stat"><span>Intraday BUY</span><strong className="up-t">{stats.buy}</strong></div>
        <div className="stat"><span>Intraday SELL</span><strong className="down-t">{stats.sell}</strong></div>
        <div className="stat"><span>No-trade (CPR)</span><strong className="warn-t">{stats.noTrade}</strong></div>
        <div className="stat"><span>Last 5-min candle</span><strong>{stats.lastBar ? stats.lastBar.slice(11) : '-'}</strong></div>
        <div className="stat"><span>F&O data (EOD)</span><strong>{meta.foDate ? `${stats.fno} · ${shortDate(meta.foDate)}` : '-'}</strong></div>
      </div>
      {matched.length > 0 && (
        <details className="small muted match-line">
          <summary>
            ✅ Settings matched ({matched.length}): {matched.slice(0, 6).map((r) => r.s).join(', ')}
            {matched.length > 6 ? '…' : ''}
          </summary>
          <p>{matched.map((r) => `${r.s} (${r.match.label.match(/\((.*)\)/)?.[1] || ''})`).join(', ')}</p>
        </details>
      )}

      <Card
        className="sheet-card"
        title="F&O Pro Sheet"
        right={
          <div className="sheet-head-tools">
            <button className={`btn sm ${alertsOn ? 'primary' : 'ghost'}`} onClick={toggleAlerts} aria-pressed={alertsOn} title="Toast + browser notification when a stock newly matches, gives an intraday BUY / SELL or breaks its opening range">
              {alertsOn ? '🔔' : '🔕'}
              <span className="alert-text">{alertsOn ? ' Alerts on' : ' Alerts off'}</span>
            </button>
            <input className="input" placeholder="Search symbol, company or sector" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </div>
        }
      >
        <div className="toolbar">
          <div className="seg wrap sheet-tabs" role="tablist" ref={tabsRef}>
            {VIEWS.map((v) => (
              <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)} role="tab" aria-selected={view === v.id}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {view === 'setups' && <Setups rows={shown} onOpen={onOpen} ctx={ctx} />}
        {view === 'summary' && <Summary rows={enriched} stats={stats} meta={meta} onOpen={onOpen} ctx={ctx} />}
        {view === 'active' && (
          <Grid
            title="Most Active Equities"
            ctx={ctx}
            rows={shown}
            onOpen={onOpen}
            initialSort={{ i: 5, dir: -1 }}
            empty="No stocks."
            cols={[
              rankSym((r) => r.turnRank),
              NAME,
              SEC,
              LTP,
              CHG,
              { label: 'Turnover (Cr)', x: (r) => r.valueCr, cell: (r) => dec(r.valueCr, 1), cls: 'num' },
              { label: 'Volume', x: (r) => r.volume, cell: (r) => compact(r.volume), cls: 'num', hide: 'sm' },
              { label: 'Vol Spike', x: (r) => r.volSpike, cell: (r) => <span className={r.volSpike >= c.volSpike ? 'up-t' : ''}>{mult(r.volSpike)}</span>, cls: 'num', hide: 'sm' },
              { label: '20D Avg Vol', x: (r) => r.avgVol20, cell: (r) => compact(r.avgVol20), cls: 'num', hide: 'md' },
              DELIV,
              { label: 'VWAP', x: (r) => r.vwap, cell: (r) => price(r.vwap), cls: 'num', hide: 'md' },
              { label: 'Day High', x: (r) => r.high, cell: (r) => price(r.high), cls: 'num', hide: 'md' },
              { label: 'Day Low', x: (r) => r.low, cell: (r) => price(r.low), cls: 'num', hide: 'md' },
              { label: '52W High', x: (r) => r.hi52, cell: (r) => price(r.hi52), cls: 'num', hide: 'md' },
              { label: 'RSI', x: (r) => r.rsi, cell: (r) => dec(r.rsi, 0), cls: 'num', hide: 'md' },
              { label: 'Trend & Setup', x: (r) => r.setup || r.trend, str: true, hide: 'md' },
              { label: 'Signal', x: (r) => activeSignal(r).label, cell: (r) => <Tag v={activeSignal(r)} />, str: true },
              { label: 'Remark / Target', x: (r) => remark(r), cell: (r) => <span className="small">{remark(r)}</span>, sort: false, hide: 'sm' },
              MATCH,
            ]}
            key="active"
          />
        )}
        {view === 'index' && <IndexOptions indices={indices} c={c} onChain={setChainOf} meta={meta} />}
        {view === 'fno' && (
          <Grid
            title="F&O Screener"
            ctx={ctx}
            rows={fno}
            onOpen={onOpen}
            initialSort={{ i: 8, dir: -1 }}
            empty={`No F&O data (${eod}).`}
            cols={[
              SYM,
              NAME,
              SEC,
              LTP,
              CHG,
              { label: 'Volume', x: (r) => r.volume, cell: (r) => compact(r.volume), cls: 'num', hide: 'sm' },
              { label: 'Avg Vol (20D)', x: (r) => r.avgVol20, cell: (r) => compact(r.avgVol20), cls: 'num', hide: 'md' },
              { label: 'Vol Spike', x: (r) => r.volSpike, cell: (r) => mult(r.volSpike), cls: 'num', hide: 'sm' },
              { label: 'OI %', x: (r) => r.futOiChgPct, cell: (r) => <Change value={r.futOiChgPct} /> },
              LOT,
              { label: 'Futures OI', x: (r) => r.futOi, cell: (r) => compact(r.futOi), cls: 'num', hide: 'sm' },
              { label: 'Change in OI', x: (r) => r.futOiChg, cell: (r) => <span className={r.futOiChg > 0 ? 'up-t' : r.futOiChg < 0 ? 'down-t' : ''}>{compact(r.futOiChg)}</span>, cls: 'num', hide: 'md' },
              { label: 'PCR', x: (r) => r.pcr, cell: (r) => dec(r.pcr, 2), cls: 'num' },
              { label: 'IV %', x: (r) => r.iv, cell: (r) => dec(r.iv, 1), cls: 'num', hide: 'sm' },
              MWPL,
              DELIV,
              { label: '52W High', x: (r) => r.hi52, cell: (r) => price(r.hi52), cls: 'num', hide: 'md' },
              { label: '52W Low', x: (r) => r.lo52, cell: (r) => price(r.lo52), cls: 'num', hide: 'md' },
              { label: 'Dist High %', x: (r) => r.distHi, cell: (r) => pct(r.distHi, 1), cls: 'num', hide: 'md' },
              { label: 'Dist Low %', x: (r) => r.distLo, cell: (r) => pct(r.distLo, 1), cls: 'num', hide: 'md' },
              { label: 'EMA20', x: (r) => r.ema20, cell: (r) => price(r.ema20), cls: 'num', hide: 'md' },
              { label: 'EMA50', x: (r) => r.ema50, cell: (r) => price(r.ema50), cls: 'num', hide: 'md' },
              { label: 'EMA200', x: (r) => r.ema200, cell: (r) => price(r.ema200), cls: 'num', hide: 'md' },
            ]}
            key="fno"
          />
        )}
        {view === 'chain' && (
          <>
            <p className="small muted tab-note">Open interest from the {eod}. Tap a row for the strike-wise chain.</p>
            <Grid
              title="Option Chain"
              ctx={ctx}
              rows={fno.filter((r) => has(r.pcr))}
              onOpen={(r) => setChainOf(r.s)}
              initialSort={{ i: 1, dir: -1 }}
              empty={`No option data (${eod}).`}
              cols={[
                SYM,
                { label: 'PCR', x: (r) => r.pcr, cell: (r) => <Tag v={pcrSentiment(r.pcr)} /> },
                { label: 'Call OI Resistance', x: (r) => r.callOiRes, cell: (r) => <span className="down-t">{num0(r.callOiRes)}</span>, cls: 'num' },
                { label: 'Put OI Support', x: (r) => r.putOiSup, cell: (r) => <span className="up-t">{num0(r.putOiSup)}</span>, cls: 'num' },
                { label: 'Call Writing', x: (r) => (r.callWriting ? `${num0(r.callWriting)} CE +${compact(r.callWritingOi)}` : '-'), str: true, hide: 'sm' },
                { label: 'Put Writing', x: (r) => (r.putWriting ? `${num0(r.putWriting)} PE +${compact(r.putWritingOi)}` : '-'), str: true, hide: 'sm' },
                { label: 'IV %', x: (r) => r.iv, cell: (r) => dec(r.iv, 1), cls: 'num' },
                { label: 'ATM Strike', x: (r) => r.atm, cell: (r) => num0(r.atm), cls: 'num', hide: 'sm' },
                { label: 'Max Pain', x: (r) => r.maxPain, cell: (r) => num0(r.maxPain), cls: 'num', hide: 'sm' },
                { label: 'Expiry', x: (r) => r.optExpiry, str: true, hide: 'md' },
                { label: 'Range', x: (r) => oiRange(r), cell: (r) => <span className="small">{oiRange(r)}</span>, sort: false, hide: 'md' },
                MATCH,
              ]}
              key="chain"
            />
          </>
        )}
        {view === 'futures' && (
          <>
            <p className="small muted tab-note">Futures price, OI and build-up from the {eod}. Spot is live.</p>
            <Grid
              title="Futures Data"
              ctx={ctx}
              rows={fno.filter((r) => has(r.futOi))}
              onOpen={onOpen}
              initialSort={{ i: 6, dir: -1 }}
              empty={`No futures data (${eod}).`}
              cols={[
                SYM,
                { label: 'Futures Price', x: (r) => r.futPrice, cell: (r) => price(r.futPrice), cls: 'num' },
                { label: 'Spot LTP', x: (r) => r.ltp, cell: (r) => <Tick value={r.ltp} />, cls: 'num' },
                { label: 'Basis', x: (r) => r.futBasis, cell: (r) => <span className={r.futBasis >= 0 ? 'up-t' : 'down-t'}>{price(r.futBasis)}</span>, cls: 'num', hide: 'sm' },
                LOT,
                { label: 'Futures OI', x: (r) => r.futOi, cell: (r) => compact(r.futOi), cls: 'num', hide: 'sm' },
                { label: 'OI %', x: (r) => r.futOiChgPct, cell: (r) => <Change value={r.futOiChgPct} /> },
                { label: 'Change in OI', x: (r) => r.futOiChg, cell: (r) => compact(r.futOiChg), cls: 'num', hide: 'md' },
                { label: 'Contracts', x: (r) => r.futVol, cell: (r) => int(r.futVol), cls: 'num', hide: 'md' },
                { label: 'Build-up', x: (r) => r.futBuildup, cell: (r) => <Tag v={{ label: r.futBuildup, tone: buildupTone(r.futBuildup) }} />, str: true },
                MWPL,
                { label: 'Expiry', x: (r) => r.futExpiry, str: true, hide: 'md' },
                MATCH,
              ]}
              key="futures"
            />
          </>
        )}
        {view === 'breakout' && (
          <Grid
            title="Breakout Scanner"
            ctx={ctx}
            rows={shown.filter((r) => r.brk.kind)}
            onOpen={onOpen}
            initialSort={{ i: 4, dir: -1 }}
            empty="No stock is near its 52-week high or low."
            cols={[
              SYM,
              LTP,
              { label: '52W High', x: (r) => r.hi52, cell: (r) => price(r.hi52), cls: 'num', hide: 'md' },
              { label: 'From High', x: (r) => r.distHi, cell: (r) => <Change value={r.distHi} d={1} /> },
              { label: 'Vol Spike', x: (r) => r.volSpike, cell: (r) => <span className={r.volSpike >= c.volSpike ? 'up-t' : ''}>{mult(r.volSpike)}</span> },
              { label: 'OI %', x: (r) => r.futOiChgPct, cell: (r) => <Change value={r.futOiChgPct} />, hide: 'sm' },
              { label: 'RSI Status', x: (r) => r.rsi, cell: (r) => <Tag v={rsiStatus(r.rsi)} />, hide: 'sm' },
              { label: 'ADX Strength', x: (r) => r.adx, cell: (r) => <Tag v={adxStatus(r.adx)} />, hide: 'md' },
              { label: 'Breakout Signal', x: (r) => r.brk.label, cell: (r) => <BrkCell r={r} c={c} />, str: true },
              MATCH,
            ]}
            key="breakout"
          />
        )}
        {view === 'swing' && (
          <Grid
            title="Swing Scanner"
            ctx={ctx}
            rows={shown}
            onOpen={onOpen}
            initialSort={{ i: 9, dir: 1 }}
            empty="No stocks."
            cols={[
              SYM,
              SEC,
              LTP,
              { label: 'EMA20', x: (r) => r.ema20, cell: (r) => price(r.ema20), cls: 'num', hide: 'md' },
              { label: 'EMA50', x: (r) => r.ema50, cell: (r) => price(r.ema50), cls: 'num', hide: 'md' },
              { label: 'EMA200', x: (r) => r.ema200, cell: (r) => price(r.ema200), cls: 'num', hide: 'md' },
              { label: 'RSI', x: (r) => r.rsi, cell: (r) => <Tag v={rsiStatus(r.rsi)} />, hide: 'sm' },
              { label: 'MACD', x: (r) => macdStatus(r.macd, r.macdSig).label, cell: (r) => <Tag v={macdStatus(r.macd, r.macdSig)} />, str: true, hide: 'md' },
              { label: 'ADX', x: (r) => r.adx, cell: (r) => <Tag v={adxStatus(r.adx)} />, hide: 'sm' },
              { label: 'Swing Signal', x: (r) => (r.swing.tone === 'up' ? 0 : r.swing.tone === 'down' ? 1 : 2), cell: (r) => <Tag v={r.swing} /> },
              { label: 'ATR', x: (r) => r.atr, cell: (r) => price(r.atr), cls: 'num', hide: 'md' },
              { label: 'Trend', x: (r) => swingTrend(r), str: true, hide: 'md' },
              { label: 'Entry', x: (r) => r.swing.plan?.entry, cell: (r) => price(r.swing.plan?.entry), cls: 'num', hide: 'sm' },
              { label: 'Stop Loss', x: (r) => r.swing.plan?.stop, cell: (r) => <span className="down-t">{price(r.swing.plan?.stop)}</span>, cls: 'num', hide: 'sm' },
              { label: 'Target 1', x: (r) => r.swing.plan?.t1, cell: (r) => <span className="up-t">{price(r.swing.plan?.t1)}</span>, cls: 'num', hide: 'sm' },
              { label: 'Target 2', x: (r) => r.swing.plan?.t2, cell: (r) => <span className="up-t">{price(r.swing.plan?.t2)}</span>, cls: 'num', hide: 'md' },
              { label: 'R : R', x: (r) => (r.swing.plan ? `1 : ${r.swing.plan.rr2}` : '-'), sort: false, hide: 'md' },
              MATCH,
            ]}
            key="swing"
          />
        )}
        {view === 'heatmap' && <StockHeatmap rows={shown} sectors={sectors} onSector={onSector} onOpen={onOpen} ctx={ctx} />}
        {view === 'intraday' && (
          <Grid
            title="Intraday Scanner"
            ctx={ctx}
            rows={shown.filter((r) => r.intra.signal !== 'NO DATA')}
            onOpen={onOpen}
            initialSort={{ i: 7, dir: 1 }}
            empty="No 5-minute data yet. It arrives with the next data refresh on a trading day."
            cols={[
              SYM,
              LTP,
              { label: 'VWAP', x: (r) => r.vwap, cell: (r) => price(r.vwap), cls: 'num', hide: 'sm' },
              { label: 'Above VWAP', x: (r) => r.ltp / r.vwap - 1, cell: (r) => (r.ltp > r.vwap ? <span className="up-t">YES</span> : <span className="down-t">NO</span>) },
              { label: 'EMA 9', x: (r) => r.ema9i, cell: (r) => <span className={r.ema9i > r.ema15i ? 'up-t' : 'down-t'}>{price(r.ema9i)}</span>, cls: 'num', hide: 'md' },
              { label: 'EMA 15', x: (r) => r.ema15i, cell: (r) => price(r.ema15i), cls: 'num', hide: 'md' },
              { label: 'RSI (14)', x: (r) => r.rsiI ?? r.rsi, cell: (r) => <Tag v={rsiStatus(r.rsiI ?? r.rsi)} />, hide: 'sm' },
              { label: 'Intraday 9/15 EMA Signal', x: (r) => ({ BUY: 0, SELL: 1, WAIT: 2, 'NO-TRADE': 3 })[r.intra.signal] ?? 4, cell: (r) => <SignalCell intra={r.intra} /> },
              { label: 'MACD Status', x: (r) => macdStatus(r.macdI, r.macdIsig).label, cell: (r) => <Tag v={macdStatus(r.macdI, r.macdIsig)} />, str: true, hide: 'md' },
              { label: 'CPR', x: (r) => cprLabel(r, c), cell: (r) => cprCell(r, c), str: true, hide: 'md' },
              MATCH,
            ]}
            key="intraday"
          />
        )}
        {view === 'patterns' && (
          <>
            <p className="small muted tab-note">ORB = first 15 minutes. Prev high / low = last session. NR7 = narrowest range of 7 days, inside bar = inside the day before: both often come before a big move.</p>
            <Grid
              title="Patterns and ORB"
              ctx={ctx}
              rows={shown.filter((r) => has(r.orbHigh) || r.nr7 || r.insideBar)}
              onOpen={onOpen}
              initialSort={{ i: 9, dir: -1 }}
              empty="No intraday data yet."
              cols={[
                SYM,
                LTP,
                CHG,
                { label: 'Gap', x: (r) => gapPct(r), cell: (r) => <Tag v={gapLabel(r)} />, hide: 'sm' },
                { label: 'ORB High / Low', x: (r) => r.orbHigh, cell: (r) => `${price(r.orbHigh)} / ${price(r.orbLow)}`, cls: 'num', hide: 'md' },
                { label: 'ORB', x: (r) => orbStatus(r).label, cell: (r) => <Tag v={orbStatus(r)} />, str: true },
                { label: 'Prev Day High / Low', x: (r) => r.pdh, cell: (r) => `${price(r.pdh)} / ${price(r.pdl)}`, cls: 'num', hide: 'md' },
                { label: 'Prev Day Range', x: (r) => pdStatus(r).label, cell: (r) => <Tag v={pdStatus(r)} />, str: true, hide: 'sm' },
                { label: '20D Range', x: (r) => rangeBreak20(r).label, cell: (r) => <Tag v={rangeBreak20(r)} />, str: true, hide: 'md' },
                { label: 'Break Score', x: (r) => breakScore(r).score, cell: (r) => <Tag v={breakScore(r)} /> },
                { label: 'Patterns', x: (r) => patternTags(r).join(', '), cell: (r) => <span className="small">{patternTags(r).join(' · ') || '-'}</span>, str: true, hide: 'sm' },
                DELIV,
                MATCH,
              ]}
              key="patterns"
            />
          </>
        )}
        {view === 'fii' && <Participants p={meta.participants} />}
      </Card>
      <p className="small muted">
        Live: price, change, VWAP side, CPR zone, ATM strike and every signal move with each price tick (seconds). Intraday VWAP, EMA 9/15, RSI, MACD, opening range and CPR
        refresh every 2 minutes on the live site. Daily indicators update with the data file. Option chain, OI and futures: {eod}.
      </p>

      {toasts.length > 0 && (
        <div className="alert-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`alert-toast ${t.tone}`}>
              <span>{t.text}</span>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Dismiss">×</button>
            </div>
          ))}
        </div>
      )}
      {chainOf && <ChainModal symbol={chainOf} rows={enriched} indices={indices} onClose={() => setChainOf(null)} />}
    </>
  );
}

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
const num0 = (v) => (has(v) ? (Number.isInteger(v) ? int(v) : dec(v, 2)) : '-');
const oiRange = (r) => (has(r.putOiSup) && has(r.callOiRes) ? `${num0(r.putOiSup)} - ${num0(r.callOiRes)}` : '-');

function activeSignal(r) {
  const up = r.side === 'BULL';
  const dn = r.side === 'BEAR';
  if (up && r.volOk) return { label: 'STRONG BUY', tone: 'up' };
  if (up) return { label: 'BUY', tone: 'up' };
  if (dn && r.volOk) return { label: 'STRONG SELL', tone: 'down' };
  if (dn) return { label: 'SELL', tone: 'down' };
  return { label: r.intra.signal === 'BUY' ? 'INTRADAY BUY' : r.intra.signal === 'SELL' ? 'INTRADAY SELL' : 'WAIT', tone: sigTone(r.intra.signal) };
}

function remark(r) {
  if (r.side && r.plan) return `${r.side === 'BULL' ? 'BUY' : 'SELL'} (${r.atm} ${r.side === 'BULL' ? 'CE' : 'PE'}) | SL ${price(r.plan.stop)} | T1 ${price(r.plan.t1)}`;
  if (r.intra.plan) return `${sigText(r.intra)} | SL ${price(r.intra.plan.stop)} | T1 ${price(r.intra.plan.t1)}`;
  return '-';
}

function BrkCell({ r, c }) {
  const plan = r.brk.kind === 'up' || r.brk.kind === 'down' ? swingSignal(r, c).plan || null : null;
  return (
    <span className={`tag ${toneClass(r.brk.tone)}`}>
      {r.brk.label}
      {plan && <small className="muted"> · SL {price(plan.stop)}</small>}
    </span>
  );
}

function cprCell(r, c) {
  const l = cprLabel(r, c);
  if (!l) return '-';
  if (l === 'WIDE') return <span className="warn-t">WIDE ({dec(r.cprWidthPct, 2)}%)</span>;
  return <span className={l === 'INSIDE' ? 'warn-t' : l === 'ABOVE' ? 'up-t' : 'down-t'}>{l}</span>;
}

function emaVwap(r) {
  if (!has(r.vwap)) return '-';
  const up = r.ema9i > r.ema15i;
  const above = r.ltp > r.vwap;
  return `${up ? '9>15' : '9<15'} EMA & ${above ? '>VWAP' : '<VWAP'}`;
}

function Setups({ rows, onOpen, ctx }) {
  const rank = (side) =>
    rows
      .filter((r) => r.side === side)
      .sort((a, b) => b.score - a.score)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  const cols = (side) => [
    rankSym((r) => r.rank),
    SEC,
    { label: 'Setup Type', x: (r) => r.setup, str: true, hide: 'sm' },
    { label: 'Conviction', x: (r) => r.score, cell: (r) => <ScoreBar value={r.score} side={r.side} /> },
    LTP,
    CHG,
    { label: 'Vol Spike', x: (r) => r.volSpike, cell: (r) => mult(r.volSpike), cls: 'num', hide: 'sm' },
    { label: '9/15 EMA & VWAP', x: (r) => emaVwap(r), cell: (r) => <span className={r.ema9i > r.ema15i && r.ltp > r.vwap ? 'up-t' : r.ema9i < r.ema15i && r.ltp < r.vwap ? 'down-t' : 'muted'}>{emaVwap(r)}</span>, str: true, hide: 'md' },
    { label: 'RSI / ADX', x: (r) => `RSI ${dec(r.rsi, 1)} | ${dec(r.adx, 0)} ADX`, sort: false, hide: 'md' },
    { label: 'Option Strike (ATM)', x: (r) => `${r.atm} ${side === 'BULL' ? 'CE' : 'PE'}`, cell: (r) => <strong className={side === 'BULL' ? 'up-t' : 'down-t'}>{r.atm} {side === 'BULL' ? 'CE' : 'PE'}</strong>, sort: false },
    LOT,
    { label: 'Entry', x: (r) => r.plan?.entry, cell: (r) => price(r.plan?.entry), cls: 'num', hide: 'sm' },
    { label: 'Stop Loss', x: (r) => r.plan?.stop, cell: (r) => <span className="down-t">{price(r.plan?.stop)}</span>, cls: 'num', hide: 'sm' },
    { label: 'Target 1', x: (r) => r.plan?.t1, cell: (r) => <span className="up-t">{price(r.plan?.t1)}</span>, cls: 'num', hide: 'sm' },
    { label: 'Target 2', x: (r) => r.plan?.t2, cell: (r) => <span className="up-t">{price(r.plan?.t2)}</span>, cls: 'num', hide: 'md' },
    { label: 'PCR / Build-up', x: (r) => (has(r.pcr) ? `${dec(r.pcr, 2)} · ${r.futBuildup}` : '-'), sort: false, hide: 'md' },
    { label: 'Intraday', x: (r) => sigText(r.intra), cell: (r) => <SignalCell intra={r.intra} />, str: true, hide: 'md' },
    MATCH,
  ];
  const bull = rank('BULL');
  const bear = rank('BEAR');
  return (
    <>
      <h3 className="sub up-t">🚀 Bullish profitable setups ({bull.length})</h3>
      <Grid title="Bullish Setups" ctx={ctx} rows={bull} cols={cols('BULL')} onOpen={onOpen} empty="No bullish setup meets the rules right now." />
      <h3 className="sub down-t">🔻 Bearish profitable setups ({bear.length})</h3>
      <Grid title="Bearish Setups" ctx={ctx} rows={bear} cols={cols('BEAR')} onOpen={onOpen} empty="No bearish setup meets the rules right now." />
      <p className="small muted">Conviction: {convictionLabel(85, 'BULL')} 85+, {convictionLabel(70, 'BULL')} 70+, otherwise MEDIUM. Rules are in Admin.</p>
    </>
  );
}

function Summary({ rows, stats, meta, onOpen, ctx }) {
  const bull = rows.filter((r) => r.side === 'BULL').length;
  const bear = rows.filter((r) => r.side === 'BEAR').length;
  const brkUp = rows.filter((r) => breakoutLabel(r).includes('BREAKOUT')).length;
  const brkDn = rows.filter((r) => breakoutLabel(r).includes('BREAKDOWN')).length;
  const adv = rows.filter((r) => r.chg > 0).length;
  const dec_ = rows.filter((r) => r.chg < 0).length;
  const longB = rows.filter((r) => r.futBuildup === 'LONG BUILDUP').length;
  const shortB = rows.filter((r) => r.futBuildup === 'SHORT BUILDUP').length;
  const items = [
    ['Stocks in universe', meta.universe],
    ['Stocks fetched successfully', meta.loaded],
    ['Advancing / declining', `${adv} / ${dec_}`],
    ['Bullish daily setups', bull, 'up-t'],
    ['Bearish daily setups', bear, 'down-t'],
    ['52W breakouts', brkUp, 'up-t'],
    ['52W breakdowns', brkDn, 'down-t'],
    ['Intraday feeds (5-min)', `${stats.intra} of ${rows.length}`],
    ['F&O stocks with OI', stats.fno],
    ['Long / short build-up', `${longB} / ${shortB}`],
    ['Settings condition matched', stats.matched, 'up-t'],
    ['F&O ban (next session)', meta.ban?.length ? meta.ban.join(', ') : 'None', meta.ban?.length ? 'warn-t' : ''],
    ['Near ban (MWPL 80%+)', rows.filter((r) => r.mwplPct >= 80 && !r.inBan).map((r) => r.s).join(', ') || 'None', 'warn-t'],
    ['Data file', meta.generatedAtIST],
  ];
  const top = rows.filter((r) => r.match.tone === 'up' || r.match.tone === 'down').sort((a, b) => b.score - a.score);
  return (
    <div className="summary-grid">
      <div className="kv-list">
        {items.map(([k, v, cls]) => (
          <div key={k} className="kv">
            <span>{k}</span>
            <strong className={cls || ''}>{v ?? '-'}</strong>
          </div>
        ))}
      </div>
      <div>
        <Grid
          title="Dashboard"
          ctx={ctx}
          rows={top}
          onOpen={onOpen}
          empty="No stock matches all settings right now."
          cols={[
            SYM,
            LTP,
            CHG,
            { label: 'Setup Type', x: (r) => r.setup || '-', str: true, hide: 'sm' },
            { label: 'Option Strike', x: (r) => `${r.atm} ${r.side === 'BULL' ? 'CE' : 'PE'}`, sort: false },
            MATCH,
          ]}
        />
      </div>
    </div>
  );
}

function StockHeatmap({ rows, sectors, onSector, onOpen, ctx }) {
  const [metric, setMetric] = useState('chg');
  const labels = { chg: 'Today', chg1w: '1 Week', chg1m: '1 Month' };
  const bySector = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.sec)) m.set(r.sec, []);
      m.get(r.sec).push(r);
    }
    return [...m.entries()]
      .map(([sec, list]) => ({ sec, list: list.sort((a, b) => (b[metric] ?? -999) - (a[metric] ?? -999)), avg: list.reduce((a, r) => a + (r[metric] || 0), 0) / list.length }))
      .sort((a, b) => b.avg - a.avg);
  }, [rows, metric]);
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r[metric] || 0))) * 0.7;
  return (
    <>
      <div className="row between wrap gap mb">
        <div className="seg" role="tablist" aria-label="Heatmap period">
          {Object.entries(labels).map(([k, v]) => (
            <button key={k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)} role="tab" aria-selected={metric === k}>
              {v}
            </button>
          ))}
        </div>
        <span className="muted small">Tiles: every stock by sector, sorted by the selected period.</span>
      </div>
      <div className="stock-heat">
        {bySector.map(({ sec, list, avg }) => (
          <section key={sec} className="heat-sector">
            <header>
              <span>{sec}</span>
              <Change value={avg} />
            </header>
            <div className="heat-cells">
              {list.map((r) => (
                <button key={r.s} className="heat-cell" style={{ background: heatColor(r[metric] || 0, scale) }} onClick={() => onOpen(r)} title={`${r.s} ${pct(r[metric])}`}>
                  <span>{r.s}</span>
                  <strong>{pct(r[metric], 1)}</strong>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <h3 className="sub">Sector summary</h3>
      <Grid
        title="Sector Summary"
        ctx={ctx}
        rows={sectors.map((x) => ({ ...x, s: x.sector }))}
        onOpen={(x) => onSector(x.sector)}
        initialSort={{ i: 3, dir: -1 }}
        empty="No sectors."
        cols={[
          { label: 'Sector', x: (x) => x.sector, cell: (x) => <strong className="sym">{x.sector}</strong>, str: true, freeze: true },
          { label: 'Stocks', x: (x) => x.count, cls: 'num' },
          { label: 'Advancing', x: (x) => x.adv, cls: 'num', hide: 'sm' },
          { label: 'Today % (avg)', x: (x) => x.chg, cell: (x) => <Change value={x.chg} /> },
          { label: '1W %', x: (x) => x.chg1w, cell: (x) => <Change value={x.chg1w} d={1} />, hide: 'sm' },
          { label: '1M %', x: (x) => x.chg1m, cell: (x) => <Change value={x.chg1m} d={1} />, hide: 'sm' },
          { label: 'Bullish', x: (x) => x.bull, cell: (x) => <span className="up-t">{x.bull}</span>, cls: 'num' },
          { label: 'Bearish', x: (x) => x.bear, cell: (x) => <span className="down-t">{x.bear}</span>, cls: 'num' },
        ]}
      />
      <p className="small muted tab-note">Tap a sector to open its stocks in the Screener.</p>
      <h3 className="sub">Multi-timeframe table</h3>
      <Grid
        title="Sector Heatmap"
        ctx={ctx}
        rows={rows}
        onOpen={onOpen}
        initialSort={{ i: 1, dir: 1 }}
        empty="No stocks."
        cols={[
          SYM,
          { label: 'Sector', x: (r) => r.sec, str: true },
          NAME,
          LTP,
          { label: 'Today %', x: (r) => r.chg, cell: (r) => <Change value={r.chg} /> },
          { label: 'Today Status', x: (r) => todayLabel(r.chg).label, cell: (r) => <Tag v={todayLabel(r.chg)} />, str: true, hide: 'sm' },
          { label: '1W %', x: (r) => r.chg1w, cell: (r) => <Change value={r.chg1w} d={1} />, hide: 'sm' },
          { label: 'Weekly Status', x: (r) => weeklyLabel(r.chg1w), cell: (r) => <span className={`tag ${r.chg1w >= 0 ? 'up-t' : 'down-t'}`}>{weeklyLabel(r.chg1w)}</span>, str: true, hide: 'md' },
          { label: '1M %', x: (r) => r.chg1m, cell: (r) => <Change value={r.chg1m} d={1} />, hide: 'sm' },
          { label: 'Monthly Status', x: (r) => monthlyLabel(r.chg1m), cell: (r) => <span className={`tag ${r.chg1m >= 0 ? 'up-t' : 'down-t'}`}>{monthlyLabel(r.chg1m)}</span>, str: true, hide: 'md' },
          { label: 'Vol Spike', x: (r) => r.volSpike, cell: (r) => mult(r.volSpike), cls: 'num', hide: 'md' },
          { label: 'Breakout Status', x: (r) => breakoutLabel(r) || 'Normal', str: true, hide: 'md' },
          MATCH,
        ]}
      />
    </>
  );
}

function IndexOptions({ indices, c, onChain, meta }) {
  const list = indices.filter((ix) => ix.name !== 'INDIA VIX');
  const vix = indices.find((ix) => ix.name === 'INDIA VIX');
  if (!list.length) return <Empty>No index data.</Empty>;
  return (
    <>
      <div className="index-scan">
        {list.map((ix) => {
          const s = indexSignal(ix, c);
          const sent = pcrSentiment(ix.pcr);
          const master = s.signal === 'BUY' && (!has(ix.pcr) || ix.pcr >= 1) ? 'BUY CALL (CE)' : s.signal === 'SELL' && (!has(ix.pcr) || ix.pcr < 1) ? 'BUY PUT (PE)' : s.signal === 'BUY' || s.signal === 'SELL' ? `${s.signal}, PCR disagrees: wait` : 'WAIT';
          return (
            <div className="card index-card" key={ix.name}>
              <div className="row between">
                <strong>{ix.name}</strong>
                <Change value={ix.chg} />
              </div>
              <strong className="index-level"><Tick value={ix.ltp} /></strong>
              <div className="grid-stats two">
                <div className="stat">
                  <span title={ix.vwapProxy ? 'Index has no traded volume, so this is the average of the 5-minute typical price' : undefined}>{ix.vwapProxy ? 'VWAP (no volume)' : 'VWAP'}</span>
                  <strong className={s.above ? 'up-t' : s.above === false ? 'down-t' : ''}>{price(ix.vwap)}</strong>
                </div>
                <div className="stat"><span>EMA 9 / 15 (5m)</span><strong>{price(ix.ema9i)} / {price(ix.ema15i)}</strong></div>
                <div className="stat"><span>RSI (5-min)</span><strong>{dec(ix.rsiI, 1)}</strong></div>
                <div className="stat"><span>ATM</span><strong>{num0(s.atm)}</strong></div>
                <div className="stat"><span>PCR (EOD)</span><strong className={toneClass(sent.tone)}>{dec(ix.pcr, 2)}</strong></div>
                <div className="stat"><span>Max pain (EOD)</span><strong>{num0(ix.maxPain)}</strong></div>
                <div className="stat"><span>OI support / resistance</span><strong>{num0(ix.putOiSup)} / {num0(ix.callOiRes)}</strong></div>
                <div className="stat"><span>ATM IV (EOD)</span><strong>{has(ix.iv) ? `${dec(ix.iv, 1)}%` : ix.name === 'SENSEX' ? 'BSE: n/a' : '-'}</strong></div>
              </div>
              <p className={`bias ${s.bias.startsWith('BULL') ? 'up-t' : s.bias.startsWith('BEAR') ? 'down-t' : 'muted'}`}>{s.bias}</p>
              <p className="master">
                Master signal: <strong className={master.startsWith('BUY CALL') ? 'up-t' : master.startsWith('BUY PUT') ? 'down-t' : 'muted'}>{master}</strong>
              </p>
              {has(ix.pcr) && (
                <button className="btn ghost sm" onClick={() => onChain(ix.name)}>
                  Strike-wise chain ({ix.optExpiry})
                </button>
              )}
            </div>
          );
        })}
      </div>
      {vix && (
        <p className="small muted mt">
          India VIX <strong>{dec(vix.ltp, 2)}</strong> (<Change value={vix.chg} />). {vix.ltp >= 20 ? 'High volatility: options are expensive, size down.' : vix.ltp <= 13 ? 'Low volatility: options are cheap.' : 'Normal volatility.'}
        </p>
      )}
      <IndexStrikes indices={list} c={c} meta={meta} />
    </>
  );
}

// ITM / ATM / OTM for each index from the real chain (last close premium of the EOD session)
function IndexStrikes({ indices, c, meta }) {
  const chain = useChains();
  if (!chain.data) return <p className="small muted mt">{chain.error || 'Loading option premiums…'}</p>;
  const rows = [];
  for (const ix of indices) {
    const ch = chain.data.chains[ix.name];
    if (!ch) continue;
    const s = indexSignal(ix, c);
    const atm = s.atm;
    const byK = new Map(ch.rows.map((r) => [r[0], r]));
    const step = ix.step || 50;
    for (const [k, tag] of [[atm - step, 'ITM CE / OTM PE'], [atm, 'ATM'], [atm + step, 'OTM CE / ITM PE']]) {
      const r = byK.get(k);
      if (!r) continue;
      rows.push({ name: `${ix.name} ${k}`, ix: ix.name, k, tag, ce: r[3], ceOi: r[1], ceDoi: r[2], pe: r[5], peOi: r[7], peDoi: r[6], bias: s.bias });
    }
  }
  if (!rows.length) return null;
  return (
    <>
      <h3 className="sub">🎯 ITM, ATM & OTM strikes (CE & PE)</h3>
      <p className="small muted tab-note">Premium = last close of the NSE session {chain.data.date}. ATM follows the live spot.</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Index</th><th>Strike</th><th>Moneyness</th><th>CE premium</th><th className="hide-sm">CE OI</th><th className="hide-md">CE chg OI</th>
              <th>PE premium</th><th className="hide-sm">PE OI</th><th className="hide-md">PE chg OI</th><th className="hide-sm">Favoured</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.tag === 'ATM' ? 'atm-row' : ''}>
                <td className="sym">{r.ix}</td>
                <td className="num">{num0(r.k)}</td>
                <td className="small">{r.tag}</td>
                <td className="num up-t">{price(r.ce)}</td>
                <td className="num hide-sm">{compact(r.ceOi)}</td>
                <td className="num hide-md">{compact(r.ceDoi)}</td>
                <td className="num down-t">{price(r.pe)}</td>
                <td className="num hide-sm">{compact(r.peOi)}</td>
                <td className="num hide-md">{compact(r.peDoi)}</td>
                <td className="hide-sm small">{r.bias.startsWith('BULL') ? `${num0(r.k)} CE` : r.bias.startsWith('BEAR') ? `${num0(r.k)} PE` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="sr-only">{meta.foDate}</span>
    </>
  );
}

// chain.json is ~250 KB, so it loads only when a chain view opens, once per page.
let chainCache = null;
function useChains() {
  const [state, setState] = useState(chainCache ? { data: chainCache } : {});
  useEffect(() => {
    if (chainCache) return undefined;
    let off = false;
    fetch(`./data/chain.json?v=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        chainCache = d;
        if (!off) setState({ data: d });
      })
      .catch((e) => !off && setState({ error: `Option chain file not available (${e.message}).` }));
    return () => {
      off = true;
    };
  }, []);
  return state;
}

function ChainModal({ symbol, rows, indices, onClose }) {
  const chain = useChains();
  const row = rows.find((r) => r.s === symbol) || indices.find((i) => i.name === symbol);
  const ch = chain.data?.chains?.[symbol];
  const maxOi = ch ? Math.max(1, ...ch.rows.flatMap((r) => [r[1], r[7]])) : 1;
  const spot = row?.ltp;
  return (
    <Modal onClose={onClose} label={`${symbol} option chain`}>
      <div className="modal-head">
        <div>
          <h2>{symbol} option chain</h2>
          <p className="muted small">
            {ch ? `Expiry ${ch.expiry} · NSE close ${chain.data.date} · spot then ${price(ch.spot)}` : chain.error || 'Loading…'}
            {has(spot) ? ` · live ${price(spot)}` : ''}
          </p>
        </div>
      </div>
      {row && (
        <div className="grid-stats">
          <div className="stat"><span>PCR</span><strong>{dec(row.pcr, 2)}</strong></div>
          <div className="stat"><span>Max pain</span><strong>{num0(row.maxPain)}</strong></div>
          <div className="stat"><span>Support (put OI)</span><strong className="up-t">{num0(row.putOiSup)}</strong></div>
          <div className="stat"><span>Resistance (call OI)</span><strong className="down-t">{num0(row.callOiRes)}</strong></div>
          <div className="stat"><span>ATM IV</span><strong>{has(row.iv) ? `${dec(row.iv, 1)}%` : '-'}</strong></div>
          <div className="stat"><span>Futures build-up</span><strong className={toneClass(buildupTone(row.futBuildup))}>{row.futBuildup || '-'}</strong></div>
        </div>
      )}
      {ch && (
        <div className="table-wrap">
          <table className="table chain">
            <thead>
              <tr>
                <th>CE OI</th><th className="hide-sm">CE chg OI</th><th>CE LTP</th><th className="strike-col">Strike</th><th>PE LTP</th><th className="hide-sm">PE chg OI</th><th>PE OI</th>
              </tr>
            </thead>
            <tbody>
              {ch.rows.map(([k, ceOi, ceDoi, ceLtp, , peLtp, peDoi, peOi]) => {
                const atm = has(spot) ? Math.abs(k - spot) === Math.min(...ch.rows.map((r) => Math.abs(r[0] - spot))) : k === ch.atm;
                const itmCe = has(spot) && k < spot;
                return (
                  <tr key={k} className={`${atm ? 'atm-row' : ''}`}>
                    <td className={`num oi-cell ${itmCe ? 'itm' : ''}`}>
                      <i className="oi-bar ce" style={{ width: `${(ceOi / maxOi) * 100}%` }} />
                      <span>{compact(ceOi)}</span>
                    </td>
                    <td className={`num hide-sm ${ceDoi > 0 ? 'down-t' : ceDoi < 0 ? 'up-t' : ''}`}>{compact(ceDoi)}</td>
                    <td className={`num ${itmCe ? 'itm' : ''}`}>{price(ceLtp)}</td>
                    <td className="num strike-col">
                      <strong>{num0(k)}</strong>
                      {k === row?.maxPain && <small className="warn-t"> MP</small>}
                    </td>
                    <td className={`num ${!itmCe ? 'itm' : ''}`}>{price(peLtp)}</td>
                    <td className={`num hide-sm ${peDoi > 0 ? 'up-t' : peDoi < 0 ? 'down-t' : ''}`}>{compact(peDoi)}</td>
                    <td className={`num oi-cell ${!itmCe ? 'itm' : ''}`}>
                      <i className="oi-bar pe" style={{ width: `${(peOi / maxOi) * 100}%` }} />
                      <span>{compact(peOi)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">Call writing (CE OI rising) caps the price; put writing (PE OI rising) supports it. MP = max pain. Shaded = in the money at the live price.</p>
      {has(spot) && row && <p className="small muted">ATM now: {num0(atmStrike(spot, row.s ? null : row.name, row.step))}</p>}
    </Modal>
  );
}

const signed = (v) => (has(v) ? `${v > 0 ? '+' : ''}${compact(v)}` : '-');

function Participants({ p }) {
  if (!p?.data) return <Empty>Participant-wise OI is not in this data file yet.</Empty>;
  const order = ['FII', 'DII', 'Pro', 'Client'].filter((k) => p.data[k]);
  const fii = participantView(p.data.FII);
  let read = null;
  if (fii && has(fii.idxFutLongPct)) {
    if (fii.idxFutLongPct >= 60) read = { text: `FIIs are net LONG in index futures (${fii.idxFutLongPct}% long). Supportive for NIFTY / BANKNIFTY.`, tone: 'up' };
    else if (fii.idxFutLongPct <= 40) read = { text: `FIIs are net SHORT in index futures (only ${fii.idxFutLongPct}% long). Rallies may face selling.`, tone: 'down' };
    else read = { text: `FIIs are balanced in index futures (${fii.idxFutLongPct}% long).`, tone: 'flat' };
  }
  return (
    <>
      <p className="small muted tab-note">NSE participant-wise open interest (contracts), session {p.date}. Small figures are the change vs the session before.</p>
      {read && (
        <p className={`fii-read ${toneClass(read.tone)}`}>
          {read.text}
          {has(fii.idxFutNetChg) ? ` Net index futures change: ${signed(fii.idxFutNetChg)} contracts.` : ''}
        </p>
      )}
      <div className="part-grid">
        {order.map((k) => {
          const rec = p.data[k];
          const v = participantView(rec);
          const lines = [
            ['Index futures', rec.idxFutLong, rec.idxFutShort, rec.chg?.idxFutLong, rec.chg?.idxFutShort, v.idxFutLongPct],
            ['Stock futures', rec.stkFutLong, rec.stkFutShort, rec.chg?.stkFutLong, rec.chg?.stkFutShort, v.stkFutLongPct],
            ['Index calls', rec.idxCallLong, rec.idxCallShort, rec.chg?.idxCallLong, rec.chg?.idxCallShort, null],
            ['Index puts', rec.idxPutLong, rec.idxPutShort, rec.chg?.idxPutLong, rec.chg?.idxPutShort, null],
          ];
          return (
            <div className="card part-card" key={k}>
              <div className="row between">
                <strong>{k}</strong>
                <span className="muted small">long / short</span>
              </div>
              {lines.map(([label, lo, sh, dlo, dsh, pctLong]) => {
                const tot = (lo || 0) + (sh || 0) || 1;
                return (
                  <div className="part-row" key={label}>
                    <div className="row between small">
                      <span>{label}</span>
                      <span className="muted">{has(pctLong) ? `${pctLong}% long` : ''}</span>
                    </div>
                    <div className="ls-bar">
                      <i className="l" style={{ width: `${((lo || 0) / tot) * 100}%` }} />
                      <i className="s" style={{ width: `${((sh || 0) / tot) * 100}%` }} />
                    </div>
                    <div className="row between small">
                      <span className="up-t">{compact(lo)} <em className="muted">{signed(dlo)}</em></span>
                      <span className="down-t">{compact(sh)} <em className="muted">{signed(dsh)}</em></span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}
