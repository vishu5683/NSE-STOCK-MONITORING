import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { getQuotes, UpstoxError } from './_lib/upstox.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  try {
    send(res, 200, await getQuotes(process.env.UPSTOX_ANALYTICS_TOKEN));
  } catch (err) {
    const e = err instanceof UpstoxError ? err : new UpstoxError('UPSTOX_ERROR', 'Live prices are unavailable.');
    send(res, e.status, { error: e.code, message: e.message });
  }
}
