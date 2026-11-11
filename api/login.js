import { send, readJson, clientIp } from './_lib/http.js';
import { configured, passwordOk, issueToken, lockedFor, recordFailure, recordSuccess } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'METHOD', message: 'Use POST.' }, { Allow: 'POST' });
  if (!configured()) return send(res, 503, { error: 'NOT_CONFIGURED', message: 'SITE_PASSWORD and SESSION_SECRET are not set on the server.' });

  const ip = clientIp(req);
  const wait = lockedFor(ip);
  if (wait > 0) return send(res, 429, { error: 'LOCKED', message: `Too many attempts. Try again in ${wait}s.`, retryAfter: wait }, { 'Retry-After': String(wait) });

  let body;
  try {
    body = await readJson(req);
  } catch {
    return send(res, 413, { error: 'BODY', message: 'Request too large.' });
  }
  if (typeof body.password !== 'string' || !body.password || body.password.length > 200 || !passwordOk(body.password)) {
    recordFailure(ip);
    return send(res, 401, { error: 'WRONG_PASSWORD', message: 'Wrong password.' });
  }
  recordSuccess(ip);
  const { token, expiresAt } = issueToken();
  send(res, 200, { token, expiresAt });
}
