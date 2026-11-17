import { send } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { getQuotes, UpstoxError } from './_lib/upstox.js';
import { getYahooQuotes } from './_lib/yahoo.js';

// Source order: Upstox (real-time, needs an active Upstox account) then Yahoo (no account, near real-time for NSE).
// After Upstox fails for a token or account reason, skip it for 10 minutes so every request does not waste 6 calls.
const SKIP_UPSTOX_MS = 10 * 60 * 1000;
let upstoxBlockedUntil = 0;
let lastUpstoxProblem = '';

export function resetSourceState() {
  upstoxBlockedUntil = 0;
  lastUpstoxProblem = '';
}

// Upstox first, Yahoo as fallback; throws when neither answers. Also used by the server-side scanner.
export async function liveQuotes() {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (token && Date.now() >= upstoxBlockedUntil) {
    try {
      return { ...(await getQuotes(token)), source: 'upstox' };
    } catch (err) {
      const e = err instanceof UpstoxError ? err : new UpstoxError('UPSTOX_ERROR', 'Live prices are unavailable.');
      lastUpstoxProblem = e.message;
      if (e.code === 'UPSTOX_TOKEN_INVALID') upstoxBlockedUntil = Date.now() + SKIP_UPSTOX_MS;
    }
  }
  try {
    return { ...(await getYahooQuotes()), fallbackReason: token ? lastUpstoxProblem : 'Upstox token is not set.' };
  } catch (err) {
    throw new Error(`No price source is available. ${lastUpstoxProblem} ${err.message}`.trim());
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'METHOD', message: 'Use GET.' }, { Allow: 'GET' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Sign in again.' });
  try {
    return send(res, 200, await liveQuotes());
  } catch (err) {
    return send(res, 502, { error: 'NO_SOURCE', message: err.message });
  }
}
