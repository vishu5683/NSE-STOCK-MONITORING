import React, { useMemo, useState, useEffect } from 'react';
import { Card, Change, SideBadge, ScoreBar, Empty } from './ui.jsx';
import { Sparkline } from './Charts.jsx';
import { price, dec, mult } from '../lib/fmt.js';

const PRESETS = [
  { id: 'all', label: 'All stocks', fn: () => true },
  { id: 'bull', label: 'Bullish setups', fn: (r) => r.side === 'BULL' },
  { id: 'bear', label: 'Bearish setups', fn: (r) => r.side === 'BEAR' },
  { id: 'vol', label: 'Volume spikes', fn: (r) => r.volOk },
  { id: 'hi', label: 'Near 52W high', fn: (r) => r.distHi >= -3 },
  { id: 'lo', label: 'Near 52W low', fn: (r) => r.distLo <= 3 },
  { id: 'watch', label: '★ Watchlist', fn: (r, ctx) => ctx.watchlist.includes(r.s) },
];

const COLUMNS = [
  { key: 's', label: 'Symbol', sort: (r) => r.s, str: true },
  { key: 'sec', label: 'Sector', sort: (r) => r.sec, str: true, hide: 'md' },
  { key: 'ltp', label: 'LTP', sort: (r) => r.ltp },
  { key: 'chg', label: '1D %', sort: (r) => r.chg },
  { key: 'chg1w', label: '1W %', sort: (r) => r.chg1w, hide: 'sm' },
  { key: 'chg1m', label: '1M %', sort: (r) => r.chg1m, hide: 'sm' },
  { key: 'volSpike', label: 'Vol x', sort: (r) => r.volSpike, hide: 'sm' },
  { key: 'rsi', label: 'RSI', sort: (r) => r.rsi, hide: 'sm' },
  { key: 'adx', label: 'ADX', sort: (r) => r.adx, hide: 'md' },
  { key: 'trend', label: 'Trend', sort: (r) => r.trend, str: true, hide: 'md' },
  { key: 'side', label: 'Signal', sort: (r) => r.side || '', str: true, hide: 'sm' },
  { key: 'score', label: 'Score', sort: (r) => r.score },
  { key: 'spark', label: '60D', sort: null, hide: 'sm' },
];

const PAGE = 60;

export default function Screener({ rows, sectors, initialSector, watchlist, onOpen, onToggleWatch }) {
  const [preset, setPreset] = useState('all');
  const [q, setQ] = useState('');
  const [sector, setSector] = useState(initialSector || '');
  const [sort, setSort] = useState({ key: 'score', dir: -1 });
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (initialSector) setSector(initialSector);
  }, [initialSector]);
  useEffect(() => setLimit(PAGE), [preset, q, sector, sort]);

  const filtered = useMemo(() => {
    const p = PRESETS.find((x) => x.id === preset) || PRESETS[0];
    const needle = q.trim().toUpperCase();
    const col = COLUMNS.find((c) => c.key === sort.key);
    const list = rows.filter((r) => p.fn(r, { watchlist }) && (!sector || r.sec === sector) && (!needle || r.s.includes(needle) || r.sec.toUpperCase().includes(needle)));
    if (col && col.sort) {
      list.sort((a, b) => {
        const x = col.sort(a);
        const y = col.sort(b);
        if (x === y) return a.s.localeCompare(b.s);
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (col.str ? String(x).localeCompare(String(y)) : x - y) * sort.dir;
      });
    }
    return list;
  }, [rows, preset, q, sector, sort, watchlist]);

  const counts = useMemo(() => Object.fromEntries(PRESETS.map((p) => [p.id, rows.filter((r) => p.fn(r, { watchlist })).length])), [rows, watchlist]);

  const head = (c) => {
    if (!c.sort) return <th key={c.key} className={c.hide ? `hide-${c.hide}` : ''}>{c.label}</th>;
    const on = sort.key === c.key;
    return (
      <th key={c.key} className={`sortable ${c.hide ? `hide-${c.hide}` : ''}`} onClick={() => setSort({ key: c.key, dir: on ? -sort.dir : c.str ? 1 : -1 })} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        {c.label} {on ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </th>
    );
  };

  return (
    <Card
      title="Screener"
      right={
        <span className="muted small">
          {filtered.length} of {rows.length} stocks
        </span>
      }
    >
      <div className="toolbar">
        <div className="seg wrap" role="tablist">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'on' : ''} onClick={() => setPreset(p.id)} role="tab" aria-selected={preset === p.id}>
              {p.label} <em>{counts[p.id]}</em>
            </button>
          ))}
        </div>
        <div className="row gap">
          <input className="input" placeholder="Search symbol or sector" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <select className="input" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector filter">
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s.sector} value={s.sector}>
                {s.sector} ({s.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="screener-hint">Score colour: green = bullish setup, red = bearish, grey = no setup. Tap a stock for details.</p>
      {filtered.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th aria-label="Watchlist" />
                {COLUMNS.map(head)}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((r) => (
                <tr key={r.s} onClick={() => onOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(r)}>
                  <td>
                    <button
                      className={`star ${watchlist.includes(r.s) ? 'on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWatch(r.s);
                      }}
                      aria-label={`Toggle watchlist for ${r.s}`}
                    >
                      ★
                    </button>
                  </td>
                  <td className="sym">{r.s}</td>
                  <td className="hide-md muted">{r.sec}</td>
                  <td className="num">{price(r.ltp)}</td>
                  <td><Change value={r.chg} /></td>
                  <td className="hide-sm"><Change value={r.chg1w} d={1} /></td>
                  <td className="hide-sm"><Change value={r.chg1m} d={1} /></td>
                  <td className="hide-sm num">{mult(r.volSpike)}</td>
                  <td className="hide-sm num">{dec(r.rsi, 0)}</td>
                  <td className="hide-md num">{dec(r.adx, 0)}</td>
                  <td className="hide-md muted small">{r.trend}</td>
                  <td className="hide-sm"><SideBadge side={r.side} /></td>
                  <td><ScoreBar value={r.score} side={r.side} /></td>
                  <td className="hide-sm"><Sparkline data={r.spark} width={70} height={22} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > limit && (
            <div className="center mt">
              <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>
                Show more ({filtered.length - limit} left)
              </button>
            </div>
          )}
        </div>
      ) : (
        <Empty>No stocks match these filters. Try a different preset or lower the score in Admin settings.</Empty>
      )}
    </Card>
  );
}
