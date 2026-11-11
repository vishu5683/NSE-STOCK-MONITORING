// Live intraday layer for every stock and index, built on the server from Yahoo 5-minute candles
// (chart endpoint, 5 trading days, one call per symbol, 10 at a time: ~260 calls in ~4 s).
// It gives the browser the same fields as data-pipeline/intraday.py, but fresh:
//   EMA 9 / 15, RSI 14, MACD 12/26/9, VWAP, opening range (first 15 min), day open,
//   previous session high / low / close and the CPR built from it.
// So intraday no longer depends on the GitHub schedule, which is often late or skipped.
// Cached for two minutes and shared by every visitor of this server instance.

import instruments from '../_instruments.json' with { type: 'json' };

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 8000;
const CACHE_MS = 2 * 60 * 1000;
const STALE_OK_MS = 15 * 60 * 1000;
const MIN_BARS = 20;
const IST_MS = 330 * 60 * 1000;

export const INDEX_TICKERS = { 'NIFTY 50': '^NSEI', 'BANK NIFTY': '^NSEBANK', SENSEX: '^BSESN', 'INDIA VIX': '^INDIAVIX' };
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

// Wilder RSI as in the pipeline: ewm(alpha=1/n, adjust=False) on gains / losses
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
const istDay = (sec) => new Date(sec * 1000 + IST_MS).toISOString().slice(0, 10);

// bars: [{ t, o, h, l, c, v }] oldest first
export function indicatorsFrom(bars, { index = false } = {}) {
  const clean = bars.filter((b) => b.c > 0);
  if (clean.length < MIN_BARS) return null;
  const closes = clean.map((b) => b.c);
  const e9 = emaSeries(closes, 9);
  const e15 = emaSeries(closes, 15);
  const e12 = emaSeries(closes, 12);
  const e26 = emaSeries(closes, 26);
  const macd = e12.map((v, i) => v - e26[i]);
  const sig = emaSeries(macd, 9);
  const last = clean.length - 1;
  const rsi = rsiLast(closes);
  const out = {
    ema9i: r2(e9[last]),
    ema15i: r2(e15[last]),
    rsiI: rsi === null ? null : Math.round(rsi * 10) / 10,
    macdI: r3(macd[last]),
    macdIsig: r3(sig[last]),
    iLtp: r2(closes[last]),
    iAt: clean[last].t ? new Date(clean[last].t * 1000).toISOString() : null,
  };

  // today = the session of the last bar (IST); previous = the session before it
  const today = istDay(clean[last].t);
  const todayBars = clean.filter((b) => istDay(b.t) === today);
  const before = clean.filter((b) => istDay(b.t) < today);
  if (todayBars.length) {
    const vol = todayBars.reduce((a, b) => a + (b.v > 0 ? b.v : 0), 0);
    const typ = (b) => (b.h + b.l + b.c) / 3;
    if (!index && vol > 0) out.vwap = r2(todayBars.reduce((a, b) => a + typ(b) * (b.v > 0 ? b.v : 0), 0) / vol);
    else {
      out.vwap = r2(todayBars.reduce((a, b) => a + typ(b), 0) / todayBars.length);
      out.vwapProxy = true; // indices have no traded volume on Yahoo
    }
    out.dayOpen = r2(todayBars[0].o);
    out.iBars = todayBars.length;
    if (todayBars.length >= 3) {
      out.orbHigh = r2(Math.max(...todayBars.slice(0, 3).map((b) => b.h)));
      out.orbLow = r2(Math.min(...todayBars.slice(0, 3).map((b) => b.l)));
    }
  }
  if (before.length) {
    const prevDay = istDay(before[before.length - 1].t);
    const pb = before.filter((b) => istDay(b.t) === prevDay);
    const H = Math.max(...pb.map((b) => b.h));
    const L = Math.min(...pb.map((b) => b.l));
    const C = pb[pb.length - 1].c;
    const P = (H + L + C) / 3;
    const bc = (H + L) / 2;
    const tc = 2 * P - bc;
    Object.assign(out, {
      pdh: r2(H),
      pdl: r2(L),
      pdc: r2(C),
      cprPivot: r2(P),
      cprBc: r2(Math.min(bc, tc)),
      cprTc: r2(Math.max(bc, tc)),
      cprWidthPct: r2((Math.abs(tc - bc) / P) * 100),
    });
  }
  return out;
}

// Yahoo chart JSON -> bars
export function barsFromChart(json) {
  const r = json?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r || !q || !Array.isArray(r.timestamp)) return [];
  return r.timestamp.map((t, i) => ({ t, o: Number(q.open?.[i]), h: Number(q.high?.[i]), l: Number(q.low?.[i]), c: Number(q.close?.[i]), v: Number(q.volume?.[i]) || 0 }));
}

export async function fetchChart(ticker) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${encodeURIComponent(ticker)}?range=5d&interval=5m`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  const stocks = {};
  const indices = {};
  let next = 0;
  let failed = 0;
  async function worker() {
    while (next < tickers.length) {
      const ticker = tickers[next++];
      const t = target.get(ticker);
      try {
        const ind = indicatorsFrom(barsFromChart(await fetchChart(ticker)), { index: t.kind === 'index' });
        if (ind) (t.kind === 'index' ? indices : stocks)[t.key] = ind;
      } catch {
        failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const count = Object.keys(stocks).length;
  if (!count) throw new Error('Yahoo intraday is unavailable.');
  return { asOf: new Date().toISOString(), source: 'yahoo-5m', stocks, indices, count, partial: failed > 0 };
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

let cache = null;
let inflight = null;

export function resetIntradayCache() {
  cache = null;
  inflight = null;
}
