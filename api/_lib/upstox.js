// Reads last prices from the Upstox LTP v3 API with a read-only Analytics Token (valid 1 year, no static IP).
// UPSTOX_ANALYTICS_TOKEN lives only in the Vercel environment.

import instruments from '../_instruments.json' with { type: 'json' };

const URL_LTP = 'https://api.upstox.com/v3/market-quote/ltp';
const CHUNK = 50;
const CACHE_MS = 4000;
const STALE_OK_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

const keyToTarget = new Map();
for (const [symbol, key] of Object.entries(instruments.stocks)) keyToTarget.set(key, { kind: 'stock', symbol });
for (const [name, key] of Object.entries(instruments.indices)) keyToTarget.set(key, { kind: 'index', name });
const allKeys = [...keyToTarget.keys()];

// "NSE_EQ:INFY" and "NSE_EQ|INE009A01021" both appear in responses; compare on the pipe form.
const canon = (k) => {
  const s = String(k || '');
  const colon = s.indexOf(':');
  const pipe = s.indexOf('|');
  return colon >= 0 && (pipe < 0 || colon < pipe) ? `${s.slice(0, colon)}|${s.slice(colon + 1)}` : s;
};

export class UpstoxError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function fetchChunk(keys, token) {
  const url = `${URL_LTP}?instrument_key=${keys.map(encodeURIComponent).join(',')}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: ctl.signal });
  } catch (err) {
    throw new UpstoxError('UPSTOX_UNREACHABLE', err.name === 'AbortError' ? 'Upstox did not answer in time.' : 'Could not reach Upstox.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new UpstoxError('UPSTOX_TOKEN_INVALID', 'Upstox rejected the Analytics Token. Generate a new one and update UPSTOX_ANALYTICS_TOKEN.');
  if (res.status === 429) throw new UpstoxError('UPSTOX_RATE_LIMIT', 'Upstox rate limit reached. Retrying shortly.', 503);
  if (!res.ok) throw new UpstoxError('UPSTOX_ERROR', `Upstox returned HTTP ${res.status}.`);
  const body = await res.json().catch(() => ({}));
  return body?.data && typeof body.data === 'object' ? body.data : {};
}

export function normalise(dataMaps, asOf) {
  const quotes = {};
  const indices = {};
  for (const data of dataMaps) {
    for (const [k, item] of Object.entries(data)) {
      const target = keyToTarget.get(canon(item?.instrument_token)) || keyToTarget.get(canon(k));
      const ltp = Number(item?.last_price);
      if (!target || !Number.isFinite(ltp) || ltp <= 0) continue;
      const q = { ltp };
      const cp = Number(item?.cp);
      if (Number.isFinite(cp) && cp > 0) q.cp = cp;
      const vol = Number(item?.volume);
      if (Number.isFinite(vol) && vol >= 0) q.vol = vol;
      if (target.kind === 'index') indices[target.name] = q;
      else quotes[target.symbol] = q;
    }
  }
  return { asOf, quotes, indices };
}

let cache = null; // { at, payload }
let inflight = null;

async function refresh(token) {
  const chunks = [];
  for (let i = 0; i < allKeys.length; i += CHUNK) chunks.push(allKeys.slice(i, i + CHUNK));
  const results = await Promise.allSettled(chunks.map((c) => fetchChunk(c, token)));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected');
  if (!ok.length) throw failed[0]?.reason || new UpstoxError('UPSTOX_ERROR', 'No price data returned.');
  const payload = normalise(ok, new Date().toISOString());
  payload.partial = failed.length > 0;
  payload.mapped = Object.keys(payload.quotes).length;
  payload.missing = instruments.missing || [];
  return payload;
}

export async function getQuotes(token, now = Date.now()) {
  if (!token) throw new UpstoxError('NOT_CONFIGURED', 'UPSTOX_ANALYTICS_TOKEN is not set on the server.', 503);
  if (cache && now - cache.at < CACHE_MS) return cache.payload;
  if (!inflight) {
    inflight = refresh(token)
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
    // keep serving the last good prices for a few minutes, clearly marked stale
    if (cache && now - cache.at < STALE_OK_MS && err.code !== 'UPSTOX_TOKEN_INVALID') {
      return { ...cache.payload, stale: true, warning: err.message };
    }
    throw err;
  }
}

export function resetCache() {
  cache = null;
  inflight = null;
}

export const stats = { stocks: Object.keys(instruments.stocks).length, indices: Object.keys(instruments.indices).length };
