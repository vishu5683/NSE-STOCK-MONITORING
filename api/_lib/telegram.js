// Pushes a plain-text message to one Telegram chat via the Bot API. The bot token and chat id
// stay server-side (Vercel env vars) so they never reach the browser bundle.
//
// TELEGRAM_BOT_TOKEN  token from @BotFather
// TELEGRAM_CHAT_ID    numeric chat id (DM with the bot, or a group/channel the bot is in)

const MAX_LEN = 500;
const MIN_GAP_MS = 4000; // one alert batch every few seconds at most, per visitor
const sent = new Map(); // ip -> last-sent ms

export function configured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export function throttled(ip, now = Date.now()) {
  const last = sent.get(ip) || 0;
  if (now - last < MIN_GAP_MS) return true;
  sent.set(ip, now);
  if (sent.size > 5000) sent.clear(); // cheap memory guard
  return false;
}

export async function sendTelegram(text) {
  if (!configured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  const body = String(text || '').slice(0, MAX_LEN);
  if (!body) return { ok: false, reason: 'EMPTY' };
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: body, disable_web_page_preview: true }),
  });
  if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
  return { ok: true };
}

export function resetTelegramThrottle() {
  sent.clear();
}
