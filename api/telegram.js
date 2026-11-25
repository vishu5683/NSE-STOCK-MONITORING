import { send, readJson, clientIp } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { originAllowed } from './_lib/origin.js';
import { configured, parseAlert, allowRate, deliver } from './_lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!originAllowed(req)) return send(res, 403, { error: 'FORBIDDEN_ORIGIN' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED' });
  if (!configured()) return send(res, 200, { ok: false, reason: 'NOT_CONFIGURED' });

  const parsed = parseAlert(await readJson(req, 4096));
  if (parsed.error) return send(res, 400, { error: parsed.error });
  if (!allowRate(clientIp(req))) return send(res, 429, { ok: false, reason: 'RATE_LIMITED' });

  // Telegram alerts come only from the server scanner (one source, live data, no duplicates when
  // a browser has the same screen open). The browser keeps its in-app alerts.
  if (process.env.BROWSER_TELEGRAM !== 'on') return send(res, 200, { ok: true, sent: 0, skipped: 'SERVER_SCANNER_ONLY' });
  const r = await deliver(parsed.screen, parsed.items);
  return send(res, r.ok ? 200 : 502, r);
}
