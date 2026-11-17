import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { getDepth } from './_lib/upstoxOi.js';

// Live market depth (5 bid / ask levels) for one stock: ?s=RELIANCE
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  const q = new URL(req.url || '/', 'http://x').searchParams.get('s') || req.query?.s || '';
  const sym = String(q).trim().toUpperCase();
  if (!/^[A-Z0-9&-]{1,20}$/.test(sym)) return send(res, 400, { error: 'SYMBOL', message: 'Unknown symbol.' });
  try {
    return send(res, 200, await getDepth(sym, process.env.UPSTOX_ANALYTICS_TOKEN));
  } catch (err) {
    const status = err.code === 'NOT_CONFIGURED' ? 503 : err.code === 'NO_DATA' ? 404 : 502;
    return send(res, status, { error: err.code || 'NO_SOURCE', message: err.message });
  }
}
