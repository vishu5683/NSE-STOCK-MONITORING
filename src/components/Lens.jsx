import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, Change } from './ui.jsx';
import { price, dec, compact, int } from '../lib/fmt.js';
import { exportTable } from '../lib/exporters.js';
import { FIELDS, FIELD_BY_KEY, OPS, blankCondition, runQuery, queryText, PRESETS, loadSavedScreens, saveScreen, deleteScreen } from '../lib/lens.js';

const OP_LABEL = { '>': '>', '<': '<', '>=': '>=', '<=': '<=', '=': '=' };
const ALERT_KEY = 'nsestocks.lensAlerts';
const readFlag = (k) => {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
};

function fmtField(key, v) {
  if (v === null || v === undefined) return '-';
  if (key === 'mcap' || key === 'netProfit' || key === 'valueCr') return `${compact(v)} Cr`;
  if (key.startsWith('chg')) return <Change value={v} />;
  if (['pe', 'pb', 'de', 'roa', 'promoter', 'rsi', 'adx'].includes(key)) return dec(v, key === 'rsi' || key === 'adx' ? 0 : 2);
  if (key === 'ltp') return price(v);
  return dec(v, 2);
}

function ConditionRow({ c, onChange, onRemove, canRemove }) {
  return (
    <div className="lens-row">
      <select className="input" value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value })}>
        {Object.entries(
          FIELDS.reduce((m, f) => ((m[f.group] = m[f.group] || []).push(f), m), {}),
        ).map(([group, fs]) => (
          <optgroup key={group} label={group}>
            {fs.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <select className="input lens-op" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value })}>
        {Object.keys(OPS).map((op) => (
          <option key={op} value={op}>{OP_LABEL[op]}</option>
        ))}
      </select>
      <input className="input lens-val" type="number" placeholder="value" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
      {canRemove && (
        <button className="btn ghost sm" aria-label="Remove condition" onClick={onRemove}>✕</button>
      )}
    </div>
  );
}

export default function Lens({ rows, settings, meta, onOpen }) {
  const [conditions, setConditions] = useState([blankCondition()]);
  const [sector, setSector] = useState('');
  const [q, setQ] = useState('');
  const [screenName, setScreenName] = useState('');
  const [saved, setSaved] = useState(() => loadSavedScreens());
  const [alertsOn, setAlertsOn] = useState(() => readFlag(ALERT_KEY));
  const [toasts, setToasts] = useState([]);
  const matchedPrev = useRef(null);
  const [fundAsOf, setFundAsOf] = useState(null);
  const [fundMap, setFundMap] = useState(null); // null = loading, {} = loaded (maybe empty)

  useEffect(() => {
    let dead = false;
    fetch('./data/fundamentals.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (dead) return;
        setFundMap(j?.stocks || {});
        setFundAsOf(j?.asOf || null);
      })
      .catch(() => !dead && setFundMap({}));
    return () => {
      dead = true;
    };
  }, []);

  // one pass: technical row + fundamentals merged by symbol
  const merged = useMemo(() => {
    if (!fundMap) return [];
    return rows.map((r) => ({ ...r, ...(fundMap[r.s] || {}) }));
  }, [rows, fundMap]);

  const sectors = useMemo(() => [...new Set(merged.map((r) => r.sector || r.sec).filter(Boolean))].sort(), [merged]);

  const filtered = useMemo(() => {
    let list = sector ? merged.filter((r) => (r.sector || r.sec) === sector) : merged;
    list = runQuery(list, conditions);
    const needle = q.trim().toUpperCase();
    if (needle) list = list.filter((r) => r.s.includes(needle) || (r.name || '').toUpperCase().includes(needle));
    return list;
  }, [merged, sector, conditions, q]);

  // Live alert: a stock that newly starts matching the active query/sector (same pattern as
  // Scanners.jsx's alertEvents, scoped to this screen) -- toast + the same /api/telegram push.
  useEffect(() => {
    const next = new Set(filtered.map((r) => r.s));
    const prev = matchedPrev.current;
    matchedPrev.current = next;
    if (!alertsOn || !prev || !queryText(conditions)) return;
    const added = [...next].filter((s) => !prev.has(s)).slice(0, 8);
    if (!added.length) return;
    const label = screenName.trim() || 'Lens screen';
    const text = `${label}: NEW match - ${added.join(', ')}`;
    const stamp = Date.now();
    setToasts((t) => [{ id: stamp, text }, ...t].slice(0, 5));
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`${settings.clientName}: ${label}`, { body: text, tag: 'nsestocks-lens' });
      }
    } catch {
      /* some mobile browsers only allow notifications from a service worker */
    }
    fetch('./api/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, alertsOn]);
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

  const setCondition = (i, next) => setConditions((cs) => cs.map((c, j) => (j === i ? next : c)));
  const addCondition = () => setConditions((cs) => [...cs, blankCondition()]);
  const removeCondition = (i) => setConditions((cs) => cs.filter((_, j) => j !== i));
  const applyPreset = (p) => {
    setConditions(p.conditions.map((c) => ({ ...c })));
    setScreenName(p.name);
  };
  const doSave = () => {
    const name = screenName.trim();
    if (!name) return;
    setSaved(saveScreen(name, conditions));
  };
  const doDelete = (name) => setSaved(deleteScreen(name));
  const doExport = () =>
    exportTable({
      title: screenName.trim() || 'Lens Screen',
      cols,
      rows: filtered,
      meta,
      settings,
    });

  const cols = useMemo(
    () => [
      { label: 'Company', x: (r) => r.s, cell: (r) => <strong className="sym">{r.s}</strong>, str: true },
      { label: 'Sector', x: (r) => r.sector || r.sec || '', cell: (r) => <span className="muted small">{r.sector || r.sec || '-'}</span>, str: true },
      { label: 'Sub Sector', x: (r) => r.subSector || '', cell: (r) => <span className="muted small">{r.subSector || '-'}</span>, str: true },
      { label: 'LTP', x: (r) => r.ltp, cell: (r) => price(r.ltp), cls: 'num' },
      { label: '1D %', x: (r) => r.chg, cell: (r) => <Change value={r.chg} />, cls: 'num' },
      { label: '1W %', x: (r) => r.chg1w, cell: (r) => <Change value={r.chg1w} />, cls: 'num' },
      { label: '1M %', x: (r) => r.chg1m, cell: (r) => <Change value={r.chg1m} />, cls: 'num' },
      { label: 'Market Cap (Cr)', x: (r) => r.marketCap, cell: (r) => fmtField('mcap', r.marketCap), cls: 'num' },
      { label: 'P/E', x: (r) => r.pe, cell: (r) => fmtField('pe', r.pe), cls: 'num' },
      { label: 'P/B', x: (r) => r.pb, cell: (r) => fmtField('pb', r.pb), cls: 'num' },
      { label: 'Debt/Equity', x: (r) => r.debtToEquity, cell: (r) => fmtField('de', r.debtToEquity), cls: 'num' },
      { label: 'Net Profit (Cr)', x: (r) => r.netProfit, cell: (r) => fmtField('netProfit', r.netProfit), cls: 'num' },
      { label: 'Insider Hold % (proxy)', x: (r) => r.promoterPct, cell: (r) => fmtField('promoter', r.promoterPct), cls: 'num', hide: 'md' },
    ],
    [],
  );

  const [sort, setSort] = useState(null);
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [filtered.length]);
  const list = useMemo(() => {
    if (!sort) return filtered;
    const col = cols[sort.i];
    if (!col) return filtered;
    return [...filtered].sort((a, b) => {
      const x = col.x(a);
      const y = col.x(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (col.str ? String(x).localeCompare(String(y)) : x - y) * sort.dir;
    });
  }, [filtered, cols, sort]);

  return (
    <div className="lens">
      <Card>
        <div className="lens-head">
          <h2>Lens <span className="tag muted">Beta</span></h2>
          <button className={`btn sm ${alertsOn ? 'primary' : 'ghost'}`} onClick={toggleAlerts} aria-pressed={alertsOn} title="Toast + Telegram when a stock newly matches this screen">
            {alertsOn ? '🔔' : '🔕'} {alertsOn ? ' Alerts on' : ' Alerts off'}
          </button>
        </div>

        <div className="lens-presets">
          {PRESETS.map((p) => (
            <button key={p.name} className="btn ghost sm" onClick={() => applyPreset(p)}>{p.name}</button>
          ))}
        </div>

        <div className="lens-query">
          {conditions.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <div className="lens-and">AND</div>}
              <ConditionRow c={c} onChange={(next) => setCondition(i, next)} onRemove={() => removeCondition(i)} canRemove={conditions.length > 1} />
            </React.Fragment>
          ))}
          <div className="lens-query-tools">
            <button className="btn ghost sm" onClick={addCondition}>+ Add condition</button>
            <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Screen name (for saving / alerts)" value={screenName} onChange={(e) => setScreenName(e.target.value)} />
            <button className="btn ghost sm" onClick={doSave} disabled={!screenName.trim()}>💾 Save screen</button>
          </div>
          {queryText(conditions) && <div className="muted small lens-query-text">{queryText(conditions)}</div>}
        </div>

        {saved.length > 0 && (
          <div className="lens-presets">
            {saved.map((s) => (
              <span key={s.name} className="lens-saved-chip">
                <button className="btn ghost sm" onClick={() => { setConditions(s.conditions.map((c) => ({ ...c }))); setScreenName(s.name); }}>{s.name}</button>
                <button className="btn ghost sm" aria-label={`Delete ${s.name}`} onClick={() => doDelete(s.name)}>✕</button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="grid-tools">
          <select className="input" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input className="input" placeholder="Search symbol / company..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <span className="muted small">{filtered.length} {filtered.length === 1 ? 'stock' : 'stocks'}</span>
          <button className="btn ghost sm" onClick={doExport} disabled={!filtered.length}>⬇ Excel</button>
        </div>
        {fundMap === null && <p className="muted small">Loading fundamentals...</p>}
        {fundMap && !Object.keys(fundMap).length && (
          <p className="muted small">Fundamentals (P/E, P/B, Debt/Equity, Net Profit, Market Cap) have not been fetched yet (daily job, see data-pipeline/fundamentals.py). Price/technical fields still work.</p>
        )}
        {fundAsOf && <p className="muted small">Fundamentals as of {new Date(fundAsOf).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST. Insider-holding % is a Yahoo proxy, not the real NSE promoter-holding figure.</p>}
        {!filtered.length ? (
          <Empty>No stock matches this screen yet.</Empty>
        ) : (
          <>
            <div className="table-wrap sheet-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {cols.map((c, i) => {
                      const on = sort?.i === i;
                      return (
                        <th key={c.label} className={`sortable ${c.hide ? `hide-${c.hide}` : ''}`} onClick={() => setSort({ i, dir: on ? -sort.dir : c.str ? 1 : -1 })} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                          {c.label} {on ? (sort.dir === 1 ? '▲' : '▼') : ''}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, limit).map((r) => (
                    <tr key={r.s} tabIndex={onOpen ? 0 : undefined} onClick={onOpen ? () => onOpen(r) : undefined} onKeyDown={onOpen ? (e) => e.key === 'Enter' && onOpen(r) : undefined}>
                      {cols.map((c) => (
                        <td key={c.label} className={`${c.hide ? `hide-${c.hide}` : ''} ${c.cls || ''}`}>{c.cell(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > limit && (
              <div className="center mt">
                <button className="btn ghost" onClick={() => setLimit(limit + 60)}>Show more ({list.length - limit} left)</button>
              </div>
            )}
          </>
        )}
      </Card>

      {toasts.length > 0 && (
        <div className="alert-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="alert-toast up">{t.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
