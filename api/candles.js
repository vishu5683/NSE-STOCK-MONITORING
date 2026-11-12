import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { fetchChart, barsFromChart, INDEX_TICKERS } from './_lib/intraday.js';
import instruments from './_instruments.json' with { type: 'json' };

// Today's 5-minute candles + running VWAP for one stock or index (the stock popup chart).
// ?s=RELIANCE or ?s=NIFTY 50. Only known symbols, so this cannot be used as an open proxy.
const CACHE_MS = 30 * 1000;
const MAX_CACHE = 300;
const IST_MS = 330 * 60 * 1000;
const cache = new Map();
const istDay = (sec) => new Date(sec * 1000 + IST_MS).toISOString().slice(0, 10);

// Upstox v3 intraday candles (official exchange data). Returns bars oldest first, or null.
export function barsFromUpstox(body) {
  const rows = body?.data?.candles;
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows
    .map((r) => ({ t: Math.floor(Date.parse(r[0]) / 1000), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) || 0 }))
    .filter((b) => Number.isFinite(b.t) && b.c > 0)
    .sort((a, b) => a.t - b.t);
}

async function upstoxBars(key, token) {
  if (!token || !key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(`https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(key)}/minutes/5`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!r.ok) return null;
    return barsFromUpstox(await r.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function sessionCandles(bars, index = false) {
  const clean = bars.filter((b) => b.c > 0 && b.h > 0 && b.l > 0);
  if (!clean.length) return null;
  const day = istDay(clean[clean.length - 1].t);
  const today = clean.filter((b) => istDay(b.t) === day);
  let pv = 0;
  let vol = 0;
  let typSum = 0;
  const out = today.map((b, i) => {
    const typ = (b.h + b.l + b.c) / 3;
    typSum += typ;
    if (!index && b.v > 0) {
      pv += typ * b.v;
      vol += b.v;
    }
    const vwap = !index && vol > 0 ? pv / vol : typSum / (i + 1);
    return [b.t, b.o, b.h, b.l, b.c, b.v, Math.round(vwap * 100) / 100];
  });
  return { day, vwapProxy: index || vol === 0, bars: out };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  const q = new URL(req.url || '/', 'http://x').searchParams.get('s') || req.query?.s || '';
  const sym = String(q).trim().toUpperCase();
  const index = Object.keys(INDEX_TICKERS).find((k) => k.toUpperCase() === sym);
  if (!index && !instruments.stocks[sym]) return send(res, 400, { error: 'SYMBOL', message: 'Unknown symbol.' });
  const ticker = index ? INDEX_TICKERS[index] : `${sym}.NS`;
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.payload);
  try {
    // Upstox official candles first (stocks and indices), Yahoo when Upstox has nothing or fails
    const key = index ? instruments.indices?.[index] : instruments.stocks[sym];
    const up = await upstoxBars(key, process.env.UPSTOX_ANALYTICS_TOKEN);
    let s = up && up.length > 1 ? sessionCandles(up, Boolean(index)) : null;
    let source = 'upstox';
    if (!s) {
      s = sessionCandles(barsFromChart(await fetchChart(ticker)), Boolean(index));
      source = 'yahoo';
    }
    if (!s) return send(res, 502, { error: 'NO_DATA', message: 'No candles for this symbol yet.' });
    const payload = { symbol: index || sym, asOf: new Date().toISOString(), source, ...s };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(ticker, { at: Date.now(), payload });
    return send(res, 200, payload);
  } catch (err) {
    if (hit) return send(res, 200, { ...hit.payload, stale: true });
    return send(res, 502, { error: 'NO_SOURCE', message: `Candles are unavailable. ${err.message}` });
  }
}
