// Lens: a small query-builder screener, modelled on the client's reference site (NSE Market
// Lens: "Price to Book (P/B) < 3 AND Net Profit (in Lakhs) > 100 AND Promoter Holding (%) > 50").
//
// v1 scope: AND-only (their reference also defaults new rows to AND; OR/NOT can follow later).
// Fundamentals (marketCap/pe/pb/debtToEquity/roa/promoterPct/netProfit/subSector) come from
// public/data/fundamentals.json, fetched once a day -- see data-pipeline/fundamentals.py for the
// honest limits (no real promoter-holding source exists free; Yahoo's insider-holding is a proxy).

export const OPS = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '=': (a, b) => Math.abs(a - b) < 1e-9,
};

// field: { key, label, group, unit, get(row) -> number|null }
export const FIELDS = [
  { key: 'mcap', label: 'Market Cap (in Cr)', group: 'Fundamentals', get: (r) => r.marketCap ?? null },
  { key: 'pe', label: 'Price to Earning (P/E)', group: 'Fundamentals', get: (r) => r.pe ?? null },
  { key: 'pb', label: 'Price to Book (P/B)', group: 'Fundamentals', get: (r) => r.pb ?? null },
  { key: 'de', label: 'Debt to Equity', group: 'Fundamentals', get: (r) => r.debtToEquity ?? null },
  { key: 'roa', label: 'Return on Assets (ROA %)', group: 'Fundamentals', get: (r) => r.roa ?? null },
  { key: 'promoter', label: 'Insider Holding % (proxy)', group: 'Fundamentals', get: (r) => r.promoterPct ?? null },
  { key: 'netProfit', label: 'Net Profit (in Cr)', group: 'Fundamentals', get: (r) => r.netProfit ?? null },
  { key: 'ltp', label: 'LTP', group: 'Price', get: (r) => r.ltp ?? null },
  { key: 'chg', label: '1-Day Return (%)', group: 'Price', get: (r) => r.chg ?? null },
  { key: 'chg1w', label: '1-Week Return (%)', group: 'Price', get: (r) => r.chg1w ?? null },
  { key: 'chg1m', label: '1-Month Return (%)', group: 'Price', get: (r) => r.chg1m ?? null },
  { key: 'rsi', label: 'RSI (14)', group: 'Technical', get: (r) => r.rsi ?? null },
  { key: 'adx', label: 'ADX (14)', group: 'Technical', get: (r) => r.adx ?? null },
  { key: 'volSpike', label: 'Volume Spike (x avg)', group: 'Technical', get: (r) => r.volSpike ?? null },
  { key: 'valueCr', label: 'Turnover (in Cr)', group: 'Technical', get: (r) => r.valueCr ?? null },
  { key: 'score', label: 'Setup Score (0-100)', group: 'Technical', get: (r) => r.score ?? null },
  { key: 'distHi', label: 'Distance from 52W High (%)', group: 'Technical', get: (r) => r.distHi ?? null },
  { key: 'distLo', label: 'Distance from 52W Low (%)', group: 'Technical', get: (r) => r.distLo ?? null },
];
export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const blankCondition = () => ({ field: 'pe', op: '<', value: '' });

// rows: array of {field, op, value}; all ANDed. A row with an empty value is ignored (not yet typed).
export function runQuery(rows, conditions) {
  const active = conditions.filter((c) => c.value !== '' && c.value !== null && !Number.isNaN(Number(c.value)));
  if (!active.length) return rows;
  return rows.filter((r) =>
    active.every((c) => {
      const field = FIELD_BY_KEY[c.field];
      const v = field ? field.get(r) : null;
      if (v === null || v === undefined) return false;
      return OPS[c.op](v, Number(c.value));
    }),
  );
}

export function queryText(conditions) {
  const active = conditions.filter((c) => c.value !== '' && c.value !== null);
  if (!active.length) return '';
  return active.map((c) => `${FIELD_BY_KEY[c.field]?.label || c.field} ${c.op} ${c.value}`).join(' AND ');
}

// A few of the reference site's "Popular Screens", using the fields above.
export const PRESETS = [
  { name: 'High Dividend Payout + Low P/E', conditions: [{ field: 'pe', op: '<', value: '15' }] },
  { name: 'High Profits + Low P/B', conditions: [{ field: 'pb', op: '<', value: '3' }, { field: 'netProfit', op: '>', value: '100' }] },
  { name: 'Low Price + High EPS', conditions: [{ field: 'ltp', op: '<', value: '200' }, { field: 'netProfit', op: '>', value: '100' }] },
  { name: 'Momentum + Breakout', conditions: [{ field: 'chg1m', op: '>', value: '7' }, { field: 'rsi', op: '>', value: '55' }, { field: 'adx', op: '>', value: '22' }] },
  { name: 'Pullback Stocks (Trend Continuation)', conditions: [{ field: 'rsi', op: '>', value: '45' }, { field: 'rsi', op: '<', value: '60' }, { field: 'chg1m', op: '>', value: '0' }] },
  { name: 'High Promoter Holding + High EPS', conditions: [{ field: 'promoter', op: '>', value: '50' }, { field: 'netProfit', op: '>', value: '50' }] },
  { name: '52W Breakout + High Return', conditions: [{ field: 'distHi', op: '>=', value: '-0.5' }, { field: 'chg1m', op: '>', value: '7' }] },
  { name: 'Price Band Based Breakout', conditions: [{ field: 'chg', op: '>', value: '5' }] },
  { name: 'High Return over 1M + High Volume', conditions: [{ field: 'chg1m', op: '>', value: '10' }, { field: 'volSpike', op: '>', value: '2' }] },
  { name: 'High Volume + High Return', conditions: [{ field: 'chg', op: '>', value: '3' }, { field: 'volSpike', op: '>', value: '2' }] },
];

export const SAVE_KEY = 'nsestocks.lensScreens';
export function loadSavedScreens() {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveScreen(name, conditions) {
  const list = loadSavedScreens().filter((s) => s.name !== name);
  list.unshift({ name, conditions, savedAt: Date.now() });
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage full / blocked: the screen just isn't persisted */
  }
  return list;
}
export function deleteScreen(name) {
  const list = loadSavedScreens().filter((s) => s.name !== name);
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}
