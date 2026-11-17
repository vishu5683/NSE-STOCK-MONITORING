import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { getChain, foNames } from './_lib/upstoxOi.js';

// Live strike-wise option chain for one F&O stock or NIFTY 50 / BANK NIFTY: ?s=RELIANCE
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  const q = new URL(req.url || '/', 'http://x').searchParams.get('s') || req.query?.s || '';
  const want = String(q).trim().toUpperCase();
  const name = foNames().find((n) => n.toUpperCase() === want);
  if (!name) return send(res, 400, { error: 'SYMBOL', message: 'Not an F&O symbol.' });
  try {
    return send(res, 200, await getChain(name, process.env.UPSTOX_ANALYTICS_TOKEN));
  } catch (err) {
    const status = err.code === 'NOT_CONFIGURED' ? 503 : err.code === 'NO_DATA' ? 404 : 502;
    return send(res, status, { error: err.code || 'NO_SOURCE', message: err.message });
  }
}
