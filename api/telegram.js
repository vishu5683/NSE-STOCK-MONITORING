import { send, readJson, clientIp } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { configured, parseAlert, allowRate, freshItems, buildText, sendTelegram } from './_lib/telegram.js';

// A browser POST always carries Origin. Another site's page cannot use this endpoint;
// ALLOWED_ORIGINS (comma list) adds hosts beyond this deployment's own, e.g. the GitHub Pages copy.
function originAllowed(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers?.host) return true;
  const extra = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.some((h) => h === host || h === origin);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!originAllowed(req)) return send(res, 403, { error: 'FORBIDDEN_ORIGIN' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED' });
  if (!configured()) return send(res, 200, { ok: false, reason: 'NOT_CONFIGURED' });

  const parsed = parseAlert(await readJson(req, 4096));
  if (parsed.error) return send(res, 400, { error: parsed.error });
  if (!allowRate(clientIp(req))) return send(res, 429, { ok: false, reason: 'RATE_LIMITED' });

  const items = freshItems(parsed.screen, parsed.items);
  if (!items.length) return send(res, 200, { ok: true, sent: 0 });

  const r = await sendTelegram(buildText(parsed.screen, items));
  return send(res, r.ok ? 200 : 502, { ...r, sent: r.ok ? items.length : 0 });
}
