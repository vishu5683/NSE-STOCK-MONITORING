// Fallback price source: Yahoo Finance "spark" endpoint. No account, no key.
// Measured on 11-Nov-2026 during market hours: NSE stocks and indices were within a minute, SENSEX about 16 minutes late.
// It is unofficial, so it can change or throttle without notice. That is why it is only a fallback.

import instruments from '../_instruments.json' with { type: 'json' };

const BASE = 'https://query1.finance.yahoo.com/v8/finance/spark';
const BATCH = 20; // Yahoo answers HTTP 400 above 20 symbols per call
const FETCH_TIMEOUT_MS = 8000;
const CACHE_MS = 15000;

const INDEX_TICKERS = { 'NIFTY 50': '^NSEI', 'BANK NIFTY': '^NSEBANK', SENSEX: '^BSESN', 'INDIA VIX': '^INDIAVIX' };

const tickerToTarget = new Map();
for (const symbol of Object.keys(instruments.stocks)) tickerToTarget.set(`${symbol}.NS`, { kind: 'stock', symbol });
for (const [name, ticker] of Object.entries(INDEX_TICKERS)) tickerToTarget.set(ticker, { kind: 'index', name });
const tickers = [...tickerToTarget.keys()];

class YahooError extends Error {
  constructor(message) {
    super(message);
    this.code = 'YAHOO_ERROR';
    this.status = 502;
  }
}

async function fetchBatch(batch) {
  const url = `${BASE}?symbols=${batch.map(encodeURIComponent).join(',')}&range=1d&interval=5m`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: ctl.signal });
    if (!res.ok) throw new YahooError(`Yahoo returned HTTP ${res.status}.`);
    return await res.json();
  } catch (err) {
    if (err instanceof YahooError) throw err;
    throw new YahooError(err.name === 'AbortError' ? 'Yahoo did not answer in time.' : 'Could not reach Yahoo.');
  } finally {
    clearTimeout(timer);
  }
}

export function normaliseYahoo(maps, nowMs = Date.now()) {
  const quotes = {};
  const indices = {};
  const ages = [];
  for (const map of maps) {
    for (const [ticker, item] of Object.entries(map || {})) {
      const target = tickerToTarget.get(ticker);
      if (!target || !item || !Array.isArray(item.close)) continue;
      let i = item.close.length - 1;
      while (i >= 0 && !(Number(item.close[i]) > 0)) i -= 1;
      if (i < 0) continue;
      const ltp = Number(item.close[i]);
      const cp = Number(item.previousClose ?? item.chartPreviousClose);
      const tsSec = Array.isArray(item.timestamp) ? Number(item.timestamp[i]) : NaN;
      const q = { ltp };
      if (Number.isFinite(cp) && cp > 0) q.cp = cp;
      if (Number.isFinite(tsSec) && tsSec > 0) {
        q.t = new Date(tsSec * 1000).toISOString();
        if (target.kind === 'stock') ages.push((nowMs - tsSec * 1000) / 60000);
      }
      if (target.kind === 'index') indices[target.name] = q;
      else quotes[target.symbol] = q;
    }
  }
  ages.sort((a, b) => a - b);
  const lagMin = ages.length ? Math.max(0, Math.round(ages[Math.floor(ages.length / 2)])) : null;
  return { quotes, indices, lagMin };
}

let cache = null;
let inflight = null;

async function refresh() {
  const batches = [];
  for (let i = 0; i < tickers.length; i += BATCH) batches.push(tickers.slice(i, i + BATCH));
  const results = await Promise.allSettled(batches.map(fetchBatch));
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw results[0]?.reason || new YahooError('No price data returned.');
  const out = normaliseYahoo(ok);
  if (Object.keys(out.quotes).length < 20) throw new YahooError('Yahoo returned too few prices.');
  return { asOf: new Date().toISOString(), source: 'yahoo', ...out, partial: results.some((r) => r.status === 'rejected'), mapped: Object.keys(out.quotes).length, missing: instruments.missing || [] };
}

export async function getYahooQuotes(now = Date.now()) {
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
  return inflight;
}

export function resetYahooCache() {
  cache = null;
  inflight = null;
}
