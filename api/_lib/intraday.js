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

// Supertrend (ATR period n, multiplier m) on bars {h, l, c}: returns { dir: 1 | -1, line }
export function supertrend(bars, n = 10, m = 3) {
  if (bars.length <= n + 1) return null;
  let atr = null;
  let upper = null;
  let lower = null;
  let dir = 1;
  for (let i = 1; i < bars.length; i += 1) {
    const { h, l, c } = bars[i];
    const pc = bars[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    atr = atr === null ? tr : (atr * (n - 1) + tr) / n; // Wilder
    const mid = (h + l) / 2;
    const bu = mid + m * atr;
    const bl = mid - m * atr;
    upper = upper === null || bu < upper || pc > upper ? bu : upper;
    lower = lower === null || bl > lower || pc < lower ? bl : lower;
    if (dir === 1 && c < lower) dir = -1;
    else if (dir === -1 && c > upper) dir = 1;
  }
  return { dir, line: dir === 1 ? lower : upper };
}

// Bollinger Bands (n, k) on closes: { up, mid, low, pctB }
export function bollinger(closes, n = 20, k = 2) {
  if (closes.length < n) return null;
  const w = closes.slice(-n);
  const mid = w.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid) ** 2, 0) / n);
  const up = mid + k * sd;
  const low = mid - k * sd;
  const last = closes[closes.length - 1];
  return { up, mid, low, pctB: up > low ? (last - low) / (up - low) : null };
}

// Slow stochastic (14, 3, 3) on bars {h, l, c}: { k, d }
export function stochastic(bars, n = 14, s1 = 3, s2 = 3) {
  if (bars.length < n + s1 + s2) return null;
  const raw = [];
  for (let i = n - 1; i < bars.length; i += 1) {
    const w = bars.slice(i - n + 1, i + 1);
    const hh = Math.max(...w.map((b) => b.h));
    const ll = Math.min(...w.map((b) => b.l));
    raw.push(hh > ll ? ((bars[i].c - ll) / (hh - ll)) * 100 : 50);
  }
  const sma = (arr, p) => arr.map((_, i) => (i + 1 < p ? null : arr.slice(i + 1 - p, i + 1).reduce((a, b) => a + b, 0) / p)).filter((v) => v !== null);
  const k = sma(raw, s1);
  const d = sma(k, s2);
  return { k: k[k.length - 1], d: d[d.length - 1] };
}

// 15-minute candles from 5-minute ones (groups of three inside each session)
export function to15m(bars, dayOf) {
  const out = [];
  let cur = null;
  let day = null;
  let n = 0;
  for (const b of bars) {
    const d = dayOf(b.t);
    if (d !== day || n === 3) {
      if (cur) out.push(cur);
      cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      day = d;
      n = 1;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      n += 1;
    }
  }
  if (cur) out.push(cur);
  return out;
}
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

  // Supertrend, Bollinger, Stochastic on 5-minute bars; trend and RSI on 15-minute bars
  const st = supertrend(clean);
  if (st) Object.assign(out, { stDir: st.dir, stLine: r2(st.line) });
  const bb = bollinger(closes);
  if (bb) Object.assign(out, { bbUp: r2(bb.up), bbMid: r2(bb.mid), bbLow: r2(bb.low), bbPctB: bb.pctB === null ? null : Math.round(bb.pctB * 100) / 100 });
  const so = stochastic(clean);
  if (so) Object.assign(out, { stochK: Math.round(so.k * 10) / 10, stochD: Math.round(so.d * 10) / 10 });
  const m15 = to15m(clean, istDay);
  if (m15.length >= 21) {
    const c15 = m15.map((b) => b.c);
    const a9 = emaSeries(c15, 9).at(-1);
    const a21 = emaSeries(c15, 21).at(-1);
    const lc = c15.at(-1);
    out.trend15 = lc > a9 && a9 > a21 ? 'UP' : lc < a9 && a9 < a21 ? 'DOWN' : 'SIDEWAYS';
    const r15 = rsiLast(c15);
    out.rsi15 = r15 === null ? null : Math.round(r15 * 10) / 10;
  }

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
