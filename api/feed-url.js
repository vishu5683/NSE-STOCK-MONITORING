import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import instruments from './_instruments.json' with { type: 'json' };

// One-time Upstox market-feed WebSocket URL for the browser (the token never leaves the server),
// plus the instrument-key -> symbol map the browser needs to read the ticks.
// The URL is short-lived and single-use; the browser asks again when it reconnects.
const keyMap = {};
for (const [s, k] of Object.entries(instruments.stocks || {})) keyMap[k] = ['s', s];
for (const [n, k] of Object.entries(instruments.indices || {})) keyMap[k] = ['i', n];

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) return send(res, 503, { error: 'NOT_CONFIGURED', message: 'UPSTOX_ANALYTICS_TOKEN is not set on the server.' });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctl.signal,
    });
    const body = await r.json().catch(() => ({}));
    const url = body?.data?.authorized_redirect_uri;
    if (!r.ok || !url) return send(res, 502, { error: 'UPSTOX', message: `Upstox feed authorize failed (HTTP ${r.status}).` });
    return send(res, 200, { url, keys: keyMap });
  } catch (err) {
    return send(res, 502, { error: 'UPSTOX_UNREACHABLE', message: err.name === 'AbortError' ? 'Upstox did not answer in time.' : 'Could not reach Upstox.' });
  } finally {
    clearTimeout(timer);
  }
}
