// Live F&O layer from Upstox (same Analytics Token as the prices):
//   * option chain per underlying (v2/option/chain): PCR, call / put OI walls, heaviest writing (OI change),
//     max pain, ATM strike and IV - the same summary data-pipeline/derivatives.py builds from the NSE bhavcopy
//   * near-month futures (v2/market-quote/quotes, full mode): price, OI, volume, previous close
// One option-chain call per underlying (~206), 12 at a time paced to about 25 a second (~9 s), cached for 5 minutes and shared by all visitors.
// Expiries and futures keys come from api/_instruments.json ("fo"), which the daily workflow rebuilds.

import instruments from '../_instruments.json' with { type: 'json' };

const BASE = 'https://api.upstox.com/v2';
const CONCURRENCY = 12;
const BUDGET_MS = 22000; // stop starting new calls here so the function (30 s limit) never times out
const MIN_GAP_MS = 40; // Upstox allows about 50 requests a second; stay near 25 a second
let nextSlot = 0;
async function paced() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}
const FETCH_TIMEOUT_MS = 9000;
const CACHE_MS = 5 * 60 * 1000;
const STALE_OK_MS = 30 * 60 * 1000;
const CHAIN_CACHE_MS = 60 * 1000;
const CHAIN_WIDTH = 10;
const IST_MS = 330 * 60 * 1000;
const INDEX_NAMES = new Set(['NIFTY 50', 'BANK NIFTY']);

export const istToday = (now = Date.now()) => new Date(now + IST_MS).toISOString().slice(0, 10);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const r2 = (v) => Math.round(v * 100) / 100;

export class OiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// nearest expiry that has not passed (an expiry day still counts until it is over)
export function pickExpiry(expiries, today) {
  return (expiries || []).find((d) => d >= today) || null;
}

export function nearFuture(futures, today) {
  return (futures || []).find(([d]) => d >= today) || null;
}

async function get(path, token, retry = true) {
  await paced();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: ctl.signal });
  } catch (err) {
    throw new OiError('UPSTOX_UNREACHABLE', err.name === 'AbortError' ? 'Upstox did not answer in time.' : 'Could not reach Upstox.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new OiError('UPSTOX_TOKEN_INVALID', `Upstox refused the token (HTTP ${res.status}).`);
  if (res.status === 429) {
    if (retry) {
      await new Promise((r) => setTimeout(r, 1100));
      return get(path, token, false);
    }
    throw new OiError('UPSTOX_RATE_LIMIT', 'Upstox rate limit reached.');
  }
  if (!res.ok) throw new OiError('UPSTOX_ERROR', `Upstox returned HTTP ${res.status}.`);
  const body = await res.json().catch(() => ({}));
  return body?.data;
}

// Upstox option chain rows -> the same per-strike shape as chain.json:
// [strike, ceOi, ceOiChange, ceLtp, ceVolume, peLtp, peOiChange, peOi, peVolume]
export function chainRows(data) {
  const rows = [];
  let spot = null;
  const ivs = new Map();
  for (const r of Array.isArray(data) ? data : []) {
    const k = Number(r?.strike_price);
    if (!isNum(k)) continue;
    if (isNum(Number(r.underlying_spot_price)) && r.underlying_spot_price > 0) spot = Number(r.underlying_spot_price);
    const side = (o) => {
      const m = o?.market_data || {};
      const oi = Number(m.oi) || 0;
      const prev = Number(m.prev_oi);
      const g = o?.option_greeks || {};
      const n = (v) => (isNum(Number(v)) ? Math.round(Number(v) * 10000) / 10000 : null);
      return { oi, doi: isNum(prev) ? oi - prev : null, ltp: isNum(Number(m.ltp)) ? Number(m.ltp) : null, vol: Number(m.volume) || 0, iv: Number(g.iv), delta: n(g.delta), theta: n(g.theta), gamma: n(g.gamma), vega: n(g.vega), ivr: n(g.iv) };
    };
    const ce = side(r.call_options);
    const pe = side(r.put_options);
    ivs.set(k, [ce.iv, pe.iv]);
    // 0-8 as chain.json; 9-16 live greeks: ceIv, ceDelta, ceTheta, ceGamma, ceVega, peIv, peDelta, peTheta
    rows.push([k, ce.oi, ce.doi, ce.ltp, ce.vol, pe.ltp, pe.doi, pe.oi, pe.vol, ce.ivr, ce.delta, ce.theta, ce.gamma, ce.vega, pe.ivr, pe.delta, pe.theta]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  return { rows, spot, ivs };
}

// Summary used by the sheets (same field names as the bhavcopy layer)
export function summarise(rows, spot, ivs, expiry) {
  if (rows.length < 3 || !isNum(spot)) return null;
  const strikes = rows.map((r) => r[0]);
  const ceOi = rows.reduce((a, r) => a + r[1], 0);
  const peOi = rows.reduce((a, r) => a + r[7], 0);
  const maxBy = (fn) => rows.reduce((best, r) => (best === null || fn(r) > fn(best) ? r : best), null);
  const res = maxBy((r) => r[1]);
  const sup = maxBy((r) => r[7]);
  const cw = maxBy((r) => (isNum(r[2]) ? r[2] : -Infinity));
  const pw = maxBy((r) => (isNum(r[6]) ? r[6] : -Infinity));
  const atm = strikes.reduce((b, k) => (Math.abs(k - spot) < Math.abs(b - spot) ? k : b), strikes[0]);
  const gaps = strikes.slice(1).map((k, i) => k - strikes[i]).filter((g) => g > 0).sort((a, b) => a - b);
  let pain = strikes[0];
  let painValue = Infinity;
  for (const s of strikes) {
    let v = 0;
    for (const r of rows) v += r[1] * Math.max(0, s - r[0]) + r[7] * Math.max(0, r[0] - s);
    if (v < painValue) {
      painValue = v;
      pain = s;
    }
  }
  // ATM IV = median of call and put IV at the ATM strike and its two neighbours. Thin strikes early in the
  // session can report absurd IVs (e.g. 151%), so values outside 1-120% are dropped.
  const ai = strikes.indexOf(atm);
  const atmIvs = strikes
    .slice(Math.max(0, ai - 1), ai + 2)
    .flatMap((k) => ivs.get(k) || [])
    .filter((v) => isNum(v) && v > 0)
    .map((v) => (v < 3 ? v * 100 : v)) // fraction or percent
    .filter((v) => v >= 1 && v <= 120)
    .sort((x, y) => x - y);
  return {
    optExpiry: expiry,
    spotLive: r2(spot),
    pcr: ceOi ? r2(peOi / ceOi) : null,
    callOiRes: res ? res[0] : null,
    putOiSup: sup ? sup[0] : null,
    callWriting: cw && cw[2] > 0 ? cw[0] : null,
    callWritingOi: cw && cw[2] > 0 ? cw[2] : null,
    putWriting: pw && pw[6] > 0 ? pw[0] : null,
    putWritingOi: pw && pw[6] > 0 ? pw[6] : null,
    maxPain: pain,
    atmLive: atm,
    step: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    iv: atmIvs.length ? Math.round(atmIvs[Math.floor(atmIvs.length / 2)] * 10) / 10 : null,
    ceOi,
    peOi,
  };
}

async function optionChain(name, today, token) {
  const f = instruments.fo?.[name];
  const expiry = f && pickExpiry(f.expiries, today);
  if (!expiry) return null;
  const data = await get(`/option/chain?instrument_key=${encodeURIComponent(f.underlying)}&expiry_date=${expiry}`, token);
  const c = chainRows(data);
  return { expiry, ...c };
}

async function futuresQuotes(names, today, token) {
  const keyToName = new Map();
  for (const n of names) {
    const fut = nearFuture(instruments.fo?.[n]?.futures, today);
    if (fut) keyToName.set(fut[1], { name: n, expiry: fut[0] });
  }
  const keys = [...keyToName.keys()];
  const out = {};
  for (let i = 0; i < keys.length; i += 400) {
    const data = await get(`/market-quote/quotes?instrument_key=${keys.slice(i, i + 400).map(encodeURIComponent).join(',')}`, token);
    for (const q of Object.values(data || {})) {
      const t = keyToName.get(q?.instrument_token);
      const ltp = Number(q?.last_price);
      if (!t || !isNum(ltp) || ltp <= 0) continue;
      // previous close = last price - net change (ohlc.close is today's running close during the session)
      const nc = Number(q?.net_change);
      const cp = isNum(nc) ? r2(ltp - nc) : null;
      out[t.name] = { futLive: ltp, futOiLive: Number(q?.oi) || null, futVolLive: Number(q?.volume) || null, futCp: cp, futExpiry: t.expiry };
    }
  }
  return out;
}

let cache = null;
let inflight = null;

async function refresh(token, now) {
  const today = istToday(now);
  const names = Object.keys(instruments.fo || {});
  if (!names.length) throw new OiError('NOT_CONFIGURED', 'No F&O instruments in _instruments.json. Run npm run instruments.');
  const stocks = {};
  const indices = {};
  let failed = 0;
  let firstError = null;
  let next = 0;
  let skipped = 0;
  const started = Date.now();
  async function worker() {
    while (next < names.length) {
      if (Date.now() - started > BUDGET_MS) {
        skipped = names.length - next;
        next = names.length;
        break;
      }
      const n = names[next++];
      try {
        const c = await optionChain(n, today, token);
        const s = c && summarise(c.rows, c.spot, c.ivs, c.expiry);
        if (s) (INDEX_NAMES.has(n) ? indices : stocks)[n] = s;
      } catch (err) {
        failed += 1;
        firstError ||= err;
        if (err.code === 'UPSTOX_TOKEN_INVALID') throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  try {
    const fut = await futuresQuotes(names, today, token);
    for (const [n, f] of Object.entries(fut)) {
      const target = INDEX_NAMES.has(n) ? indices : stocks;
      target[n] = { ...(target[n] || {}), ...f };
    }
  } catch (err) {
    firstError ||= err;
  }
  const count = Object.values(stocks).filter((x) => isNum(x.pcr)).length; // stocks with a live option chain
  if (!count && !Object.keys(stocks).length) throw firstError || new OiError('UPSTOX_ERROR', 'No option data returned.');
  return { asOf: new Date().toISOString(), day: today, source: 'upstox', stocks, indices, count, futures: Object.values(stocks).filter((x) => isNum(x.futLive)).length, failed, skipped, ms: Date.now() - started, partial: failed > 0 || skipped > 0, warning: failed ? firstError?.message : undefined };
}

export async function getOi(token, now = Date.now()) {
  if (!token) throw new OiError('NOT_CONFIGURED', 'UPSTOX_ANALYTICS_TOKEN is not set on the server.');
  if (cache && now - cache.at < CACHE_MS) return cache.payload;
  if (!inflight) {
    inflight = refresh(token, now)
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
    if (cache && now - cache.at < STALE_OK_MS && err.code !== 'UPSTOX_TOKEN_INVALID') return { ...cache.payload, stale: true, warning: err.message };
    throw err;
  }
}

// Market depth for one stock: 5 bid / ask levels, total buy / sell quantity, circuit limits (full quote)
const depthCache = new Map();
export async function getDepth(symbol, token, now = Date.now()) {
  if (!token) throw new OiError('NOT_CONFIGURED', 'UPSTOX_ANALYTICS_TOKEN is not set on the server.');
  const key = instruments.stocks?.[symbol];
  if (!key) throw new OiError('NO_DATA', 'Unknown symbol.');
  const hit = depthCache.get(symbol);
  if (hit && now - hit.at < 5000) return hit.payload;
  const data = await get(`/market-quote/quotes?instrument_key=${encodeURIComponent(key)}`, token);
  const q = Object.values(data || {})[0];
  if (!q) throw new OiError('NO_DATA', 'No quote for this symbol.');
  const lv = (arr) => (Array.isArray(arr) ? arr.slice(0, 5).map((x) => [Number(x.price) || 0, Number(x.quantity) || 0, Number(x.orders) || 0]) : []);
  const payload = {
    symbol,
    asOf: new Date().toISOString(),
    ltp: Number(q.last_price) || null,
    buy: lv(q.depth?.buy),
    sell: lv(q.depth?.sell),
    totalBuy: Number(q.total_buy_quantity) || null,
    totalSell: Number(q.total_sell_quantity) || null,
    avgPrice: Number(q.average_price) || null,
    upperCircuit: Number(q.upper_circuit_limit) || null,
    lowerCircuit: Number(q.lower_circuit_limit) || null,
    volume: Number(q.volume) || null,
  };
  if (depthCache.size > 300) depthCache.delete(depthCache.keys().next().value);
  depthCache.set(symbol, { at: Date.now(), payload });
  return payload;
}

// one underlying, strike-wise, for the chain popup
const chainCache = new Map();
export async function getChain(name, token, now = Date.now()) {
  if (!token) throw new OiError('NOT_CONFIGURED', 'UPSTOX_ANALYTICS_TOKEN is not set on the server.');
  const hit = chainCache.get(name);
  if (hit && now - hit.at < CHAIN_CACHE_MS) return hit.payload;
  const c = await optionChain(name, istToday(now), token);
  if (!c || !c.rows.length || !isNum(c.spot)) throw new OiError('NO_DATA', 'No option chain for this symbol right now.');
  const width = INDEX_NAMES.has(name) ? CHAIN_WIDTH * 3 : CHAIN_WIDTH;
  const atm = c.rows.reduce((b, r) => (Math.abs(r[0] - c.spot) < Math.abs(b - c.spot) ? r[0] : b), c.rows[0][0]);
  const i = c.rows.findIndex((r) => r[0] === atm);
  const payload = { symbol: name, source: 'upstox', asOf: new Date().toISOString(), expiry: c.expiry, spot: r2(c.spot), atm, rows: c.rows.slice(Math.max(0, i - width), i + width + 1) };
  if (chainCache.size > 300) chainCache.delete(chainCache.keys().next().value);
  chainCache.set(name, { at: Date.now(), payload });
  return payload;
}

export function resetOiCache() {
  cache = null;
  inflight = null;
  chainCache.clear();
}

export const foNames = () => Object.keys(instruments.fo || {});
