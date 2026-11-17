import { send, readJson, clientIp } from './_lib/http.js';
import { configured, throttled, sendTelegram } from './_lib/telegram.js';

// Forwards a signal alert (new setup match, intraday BUY/SELL, or ORB break -- the same events the
// in-page toast/browser-notification already shows) to Telegram, so it reaches the client even when
// the site tab isn't open. The browser is the trigger (it already detects the event live); this
// endpoint only keeps the bot token off the client and stops one visitor from spamming the chat.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (!configured()) return send(res, 200, { ok: false, reason: 'NOT_CONFIGURED' }); // telegram not set up yet: no-op, not an error for the page

  const ip = clientIp(req);
  if (throttled(ip)) return send(res, 200, { ok: false, reason: 'THROTTLED' });

  const body = await readJson(req, 2048);
  const text = String(body?.text || '').trim();
  if (!text) return send(res, 400, { error: 'EMPTY_TEXT' });

  const r = await sendTelegram(text);
  return send(res, r.ok ? 200 : 502, r);
}
