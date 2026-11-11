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
    const shape = (map) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, { ltp: v.ltp, cp: v.cp, ts: body.asOf }]));
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
        quotes: shape(body.quotes),
        indices: shape(body.indices),
      },
    };
  } catch {
    return { error: 'Could not reach the live price service.' };
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
