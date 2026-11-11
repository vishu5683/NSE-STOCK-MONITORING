import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { getOi } from './_lib/upstoxOi.js';

// Live option-chain summary and near-month futures for every F&O stock and NIFTY / BANKNIFTY (Upstox).
// The browser keeps the NSE end-of-day values when this is not available.
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  try {
    return send(res, 200, await getOi(process.env.UPSTOX_ANALYTICS_TOKEN));
  } catch (err) {
    const status = err.code === 'NOT_CONFIGURED' ? 503 : 502;
    return send(res, status, { error: err.code || 'NO_SOURCE', message: err.message });
  }
}
