// Live 5-minute indicators for every stock: EMA 9 / 15, RSI 14, MACD 12/26/9 on Yahoo "spark" closes.
// 20 symbols per call, 5 trading days of 5-minute closes (same window as data-pipeline/intraday.py),
// so one refresh is ~14 calls. Cached for a minute and shared by every visitor of this server instance.
// VWAP needs volume, which spark does not send, so VWAP stays from the data file.

import instruments from '../_instruments.json' with { type: 'json' };

const BASE = 'https://query1.finance.yahoo.com/v8/finance/spark';
const BATCH = 20;
const FETCH_TIMEOUT_MS = 9000;
const CACHE_MS = 60 * 1000;
const STALE_OK_MS = 10 * 60 * 1000;
const MIN_BARS = 20;

const INDEX_TICKERS = { 'NIFTY 50': '^NSEI', 'BANK NIFTY': '^NSEBANK', SENSEX: '^BSESN', 'INDIA VIX': '^INDIAVIX' };
const target = new Map();
for (const s of Object.keys(instruments.stocks)) target.set(`${s}.NS`, { kind: 'stock', key: s });
for (const [name, t] of Object.entries(INDEX_TICKERS)) target.set(t, { kind: 'index', key: name });
const tickers = [...target.keys()];

// pandas ewm(span=n, adjust=False): seeded with the first value
export function emaSeries(values, n) {
  const a = 2 / (n + 1);
  const out = [];
  let prev = null;
  for (const v of values) {
    prev = prev === null ? v : a * v + (1 - a) * prev;
    out.push(prev);
  }
  return out;
}

// Wilder RSI as in pipeline: ewm(alpha=1/n, adjust=False, min_periods=n) on gains / losses
export function rsiLast(values, n = 14) {
  if (values.length <= n) return null;
  const a = 1 / n;
  let up = null;
  let dn = null;
  for (let i = 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    up = up === null ? g : a * g + (1 - a) * up;
    dn = dn === null ? l : a * l + (1 - a) * dn;
  }
  if (!dn) return null;
  return 100 - 100 / (1 + up / dn);
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function indicatorsFrom(item) {
  if (!item || !Array.isArray(item.close)) return null;
  const pts = [];
  item.close.forEach((c, i) => {
    const v = Number(c);
    if (v > 0) pts.push([Number(item.timestamp?.[i]), v]);
  });
  if (pts.length < MIN_BARS) return null;
  const closes = pts.map((p) => p[1]);
  const e9 = emaSeries(closes, 9);
  const e15 = emaSeries(closes, 15);
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const sig = emaSeries(macd, 9);
  const last = closes.length - 1;
  const rsi = rsiLast(closes);
  const ts = pts[last][0];
  return {
    ema9i: r2(e9[last]),
    ema15i: r2(e15[last]),
    rsiI: rsi === null ? null : Math.round(rsi * 10) / 10,
    macdI: r3(macd[last]),
    macdIsig: r3(sig[last]),
    iLtp: r2(closes[last]),
    iAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
  };
}

async function fetchBatch(batch) {
  const url = `${BASE}?symbols=${batch.map(encodeURIComponent).join(',')}&range=5d&interval=5m`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`Yahoo returned HTTP ${res.status}.`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseIntraday(maps) {
  const stocks = {};
  const indices = {};
  for (const map of maps) {
    for (const [ticker, item] of Object.entries(map || {})) {
      const t = target.get(ticker);
      const ind = t && indicatorsFrom(item);
      if (!ind) continue;
      (t.kind === 'index' ? indices : stocks)[t.key] = ind;
    }
  }
  return { stocks, indices };
}

let cache = null;
let inflight = null;

async function refresh() {
  const batches = [];
  for (let i = 0; i < tickers.length; i += BATCH) batches.push(tickers.slice(i, i + BATCH));
  const results = await Promise.allSettled(batches.map(fetchBatch));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw new Error(results[0]?.reason?.message || 'Yahoo intraday is unavailable.');
  const payload = { asOf: new Date().toISOString(), source: 'yahoo-5m', ...normaliseIntraday(ok) };
  payload.partial = ok.length < batches.length;
  payload.count = Object.keys(payload.stocks).length;
  return payload;
}

export async function getIntraday(now = Date.now()) {
  if (cache && now - cache.at < CACHE_MS) return cache.payload;
  if (!inflight) {
    inflight = refresh()
      .then((payload) => {
        cache = { at: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    if (cache && now - cache.at < STALE_OK_MS) return { ...cache.payload, stale: true, warning: err.message };
    throw err;
  }
}

export function resetIntradayCache() {
  cache = null;
  inflight = null;
}
