// Browser side of the production live feed (Vercel /api). On GitHub Pages or any static host the
// API does not exist, so every call degrades quietly and the site keeps showing the daily data.

const TOKEN_KEY = 'nsestocks.token';

const read = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};
const write = (v) => {
  try {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
};

export const hasToken = () => Boolean(read());
export const authHeader = () => (read() ? { Authorization: `Bearer ${read()}` } : {});
export const clearToken = () => write('');

async function jsonFetch(url, opts = {}, timeoutMs = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
    const type = res.headers.get('content-type') || '';
    const body = type.includes('json') ? await res.json().catch(() => ({})) : null;
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

// Is there a live backend (Vercel /api)? Static hosts answer 404, so no polling is started there.
export async function probe() {
  try {
    const { res, body } = await jsonFetch('./api/health', {}, 4000);
    if (!res.ok || !body?.ok) return { available: false };
    return { available: true, live: Boolean(body.live), loginRequired: Boolean(body.login) };
  } catch {
    return { available: false };
  }
}

// 'ok' | 'wrong' | 'locked' | 'none' (no backend, use the local check) | 'error'
export async function serverLogin(password) {
  try {
    const { res, body } = await jsonFetch('./api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.status === 404 || res.status === 405 || res.status === 503 || !body) return { status: 'none' };
    if (res.ok && body.token) {
      write(body.token);
      return { status: 'ok' };
    }
    if (res.status === 429) return { status: 'locked', message: body.message };
    if (res.status === 401) return { status: 'wrong', message: body.message };
    return { status: 'error', message: body.message || 'Sign-in failed.' };
  } catch {
    return { status: 'none' };
  }
}

// Returns { state } in the shape the App already understands, or { expired } / { error }.
export async function fetchLive() {
  const token = read();
  try {
    const { res, body } = await jsonFetch('./api/quotes', token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    if (res.status === 401) {
      clearToken();
      return token ? { expired: true } : { needsLogin: true };
    }
    if (!res.ok || !body?.quotes) {
      return { error: body?.message || `Live prices unavailable (HTTP ${res.status}).` };
    }
    const shape = (map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, { ltp: v.ltp, cp: v.cp, ts: v.t || body.asOf }]));
    return {
      state: {
        configured: true,
        authed: true,
        connected: true,
        message: '',
        updatedAt: body.asOf,
        mapped: body.mapped ?? Object.keys(body.quotes).length,
        unmapped: body.missing || [],
        stale: Boolean(body.stale),
        partial: Boolean(body.partial),
        warning: body.warning || '',
        source: body.source || 'upstox',
        lagMin: body.lagMin ?? null,
        fallbackReason: body.fallbackReason || '',
        quotes: shape(body.quotes),
        indices: shape(body.indices),
      },
    };
  } catch {
    return { error: 'Could not reach the live price service.' };
  }
}

// Live 5-minute indicators (EMA 9/15, RSI, MACD) for all stocks. Returns the payload or null.
export async function fetchIntraday() {
  const token = read();
  try {
    const { res, body } = await jsonFetch('./api/intraday', token ? { headers: { Authorization: `Bearer ${token}` } } : {}, 15000);
    if (!res.ok || !body?.stocks) return null;
    return body;
  } catch {
    return null;
  }
}

// Today's 5-minute candles for one symbol (stock popup). null on static hosting or any failure.
export async function fetchCandles(symbol) {
  const token = read();
  try {
    const { res, body } = await jsonFetch(`./api/candles?s=${encodeURIComponent(symbol)}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}, 10000);
    return res.ok && Array.isArray(body?.bars) ? body : null;
  } catch {
    return null;
  }
}

// Live Upstox F&O layer (option-chain summary + near-month futures) for all F&O stocks. null when unavailable.
export async function fetchOi() {
  const token = read();
  try {
    const { res, body } = await jsonFetch('./api/oi', token ? { headers: { Authorization: `Bearer ${token}` } } : {}, 28000);
    return res.ok && body?.stocks ? body : null;
  } catch {
    return null;
  }
}

// Live strike-wise chain for one F&O symbol (popup). null on static hosting or any failure.
export async function fetchChainLive(symbol) {
  const token = read();
  try {
    const { res, body } = await jsonFetch(`./api/chain?s=${encodeURIComponent(symbol)}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}, 12000);
    return res.ok && Array.isArray(body?.rows) ? body : null;
  } catch {
    return null;
  }
}

// Live 5-level market depth for one stock (popup). null when unavailable.
export async function fetchDepth(symbol) {
  const token = read();
  try {
    const { res, body } = await jsonFetch(`./api/depth?s=${encodeURIComponent(symbol)}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {}, 8000);
    return res.ok && Array.isArray(body?.buy) ? body : null;
  } catch {
    return null;
  }
}

// NSE cash session in IST, Mon-Fri 09:15-15:30. Poll fast while it is open, slowly otherwise.
export function marketOpenNow(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 + 10 && minutes <= 15 * 60 + 40;
}

export const pollMs = (now = new Date()) => (marketOpenNow(now) ? 5000 : 60000);

// Market status from the clock (IST) and the newest live tick, so a stale data file never says "OPEN" at night.
export function marketPhaseNow(now = new Date(), lastTickIso = null) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const day = ist.getUTCDay();
  const m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (day === 0 || day === 6) return { label: 'MARKET CLOSED (weekend)', open: false };
  if (m < 9 * 60) return { label: 'MARKET CLOSED (opens 09:15)', open: false };
  if (m < 9 * 60 + 15) return { label: 'PRE-OPEN', open: false };
  if (m >= 15 * 60 + 30) return { label: 'MARKET CLOSED', open: false };
  const tick = lastTickIso ? new Date(lastTickIso).getTime() : NaN;
  if (Number.isFinite(tick) && now.getTime() - tick > 20 * 60 * 1000 && m > 9 * 60 + 40) return { label: 'NO LIVE TICKS (exchange holiday?)', open: false };
  return { label: 'MARKET OPEN', open: true };
}
