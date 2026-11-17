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

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const pctVs = (a, b) => (isNum(a) && isNum(b) && b > 0 ? (a / b - 1) * 100 : null);

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
  { key: 'distAth', label: 'Distance from All Time High (%)', group: 'Technical', get: (r) => pctVs(r.ltp, r.ath) },
  { key: 'distAtl', label: 'Distance from All Time Low (%)', group: 'Technical', get: (r) => pctVs(r.ltp, r.atl) },
  { key: 'vs200', label: 'Price vs 200 EMA (%)', group: 'Technical', get: (r) => pctVs(r.ltp, r.ema200) },
  { key: 'cross', label: '50 EMA vs 200 EMA (%)', group: 'Technical', get: (r) => pctVs(r.ema50, r.ema200) },
  { key: 'vsVwap', label: 'Price vs VWAP (%)', group: 'Technical', get: (r) => pctVs(r.ltp, r.vwap) },
  { key: 'vsPdh', label: 'Price vs Previous Day High (%)', group: 'Technical', get: (r) => pctVs(r.ltp, r.pdh) },
  { key: 'volLakh', label: 'Volume (in Lakhs)', group: 'Technical', get: (r) => (isNum(r.volume) ? r.volume / 1e5 : null) },
  { key: 'ret1y', label: '1-Year Return (%)', group: 'Price', get: (r) => r.ret1y ?? null },
  { key: 'eps', label: 'EPS (TTM)', group: 'Fundamentals', get: (r) => r.eps ?? null },
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

const c = (field, op, value) => ({ field, op, value: String(value) });

// The client's chosen screens from the reference site, grouped like its tabs.
export const PRESET_GROUPS = ['Growth at a Discount', 'Momentum + Breakout', 'Miscellaneous'];
export const PRESETS = [
  { group: 'Growth at a Discount', name: 'High Profits + Low P/B', desc: 'Undervalued relative to peers.', conditions: [c('pb', '<', 3), c('netProfit', '>', 1), c('promoter', '>', 50)] },
  { group: 'Growth at a Discount', name: 'High Promoter Holding + High EPS', desc: 'Strong management + strong earnings, high conviction growth.', conditions: [c('promoter', '>', 50), c('eps', '>', 20)] },

  { group: 'Momentum + Breakout', name: 'Pullback Stocks (Trend Continuation)', desc: 'Stocks in uptrend holding above VWAP.', conditions: [c('vs200', '>', 0), c('vsVwap', '>', 0), c('volLakh', '>', 15)] },
  { group: 'Momentum + Breakout', name: '52W Breakout + High Return Over 1 Month', desc: 'Breakout confirmation with volume.', conditions: [c('distHi', '>=', -0.5), c('chg1m', '>', 10), c('volSpike', '>', 1.5)] },
  { group: 'Momentum + Breakout', name: 'Price Band Based Breakout', desc: 'Intraday / short-term breakout above the previous day high.', conditions: [c('vsPdh', '>', 0), c('chg', '>', 2), c('volSpike', '>', 1.5)] },
  { group: 'Momentum + Breakout', name: 'High Return Over 1 Month + High Volume', desc: 'Short-term momentum + liquidity, potential breakout or trend stocks.', conditions: [c('chg1m', '>', 10), c('volSpike', '>', 1.5)] },
  { group: 'Momentum + Breakout', name: 'High Volume + High Return Over 1 Year', desc: 'Trending momentum + strong liquidity, potential breakout stocks.', conditions: [c('ret1y', '>', 30), c('volSpike', '>', 1.5)] },

  { group: 'Miscellaneous', name: '52W Low Stocks', desc: 'Stocks at or within 0.5% of the 52-week low.', conditions: [c('distLo', '<=', 0.5)] },
  { group: 'Miscellaneous', name: '52W High Stocks', desc: 'Stocks at or within 0.5% of the 52-week high.', conditions: [c('distHi', '>=', -0.5)] },
  { group: 'Miscellaneous', name: 'All Time Low Stocks', desc: 'Stocks at or within 0.5% of the all-time low.', conditions: [c('distAtl', '<=', 0.5)] },
  { group: 'Miscellaneous', name: 'All Time High Stocks', desc: 'Stocks at or within 0.5% of the all-time high.', conditions: [c('distAth', '>=', -0.5)] },
  { group: 'Miscellaneous', name: 'Death Cross', desc: '50 EMA below 200 EMA, market cap above 1000 Cr.', conditions: [c('cross', '<', 0), c('mcap', '>', 1000)] },
  { group: 'Miscellaneous', name: 'Golden Cross', desc: '50 EMA above 200 EMA, market cap above 1000 Cr.', conditions: [c('cross', '>', 0), c('mcap', '>', 1000)] },
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
