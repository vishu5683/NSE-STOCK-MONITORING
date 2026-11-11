import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { getIntraday } from './_lib/intraday.js';

// Live 5-minute EMA 9/15, RSI and MACD for every stock and index, refreshed at most once a minute.
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  try {
    return send(res, 200, await getIntraday());
  } catch (err) {
    return send(res, 502, { error: 'NO_SOURCE', message: `Live indicators are unavailable. ${err.message}` });
  }
}
