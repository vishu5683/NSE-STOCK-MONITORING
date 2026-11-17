// Telegram alerts. The bot token and chat id are Vercel env vars only.
//
// TELEGRAM_BOT_TOKEN  token from @BotFather
// TELEGRAM_CHAT_ID    numeric chat id
//
// The browser never sends message text: it sends a screen name and {symbol, kind} pairs, the
// symbols must be in the instrument map, and the text is built here. So a caller who finds the
// URL cannot post arbitrary text (links, phishing) to the client's chat.

import instruments from '../_instruments.json' with { type: 'json' };

const SYMBOLS = new Set(Object.keys(instruments.stocks || {}));
const KINDS = {
  new: (s) => `${s}: new match`,
  bull: (s) => `${s}: bullish setup`,
  bear: (s) => `${s}: bearish setup`,
  buy: (s, p) => `${s}: intraday BUY${p ? ` at ${p}` : ''}`,
  sell: (s, p) => `${s}: intraday SELL${p ? ` at ${p}` : ''}`,
  orb_up: (s) => `${s}: broke above opening range`,
  orb_down: (s) => `${s}: broke below opening range`,
};
const MAX_ITEMS = 10;
const PER_IP_PER_MIN = 10;
const GLOBAL_PER_10_MIN = 60;

const ipHits = new Map(); // ip -> [ms]
let globalHits = [];
let sentDay = '';
const sentKeys = new Set(); // `${screen}|${s}|${kind}` already sent today

export function configured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

const istDay = (now) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export function cleanScreen(v) {
  const s = String(v ?? '').replace(/[^A-Za-z0-9 +&/().%,-]/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 60);
}

// -> { screen, items } or { error }
export function parseAlert(body) {
  const screen = cleanScreen(body?.screen);
  if (!screen) return { error: 'BAD_SCREEN' };
  const raw = Array.isArray(body?.items) ? body.items : [];
  if (!raw.length || raw.length > MAX_ITEMS) return { error: 'BAD_ITEMS' };
  const items = [];
  for (const it of raw) {
    const s = String(it?.s ?? '').toUpperCase();
    const k = String(it?.k ?? '');
    if (!SYMBOLS.has(s) || !KINDS[k]) return { error: 'BAD_ITEMS' };
    const p = typeof it.p === 'number' && Number.isFinite(it.p) && it.p > 0 ? Math.round(it.p * 100) / 100 : null;
    items.push({ s, k, p });
  }
  return { screen, items };
}

export function allowRate(ip, now = Date.now()) {
  globalHits = globalHits.filter((t) => now - t < 10 * 60_000);
  if (globalHits.length >= GLOBAL_PER_10_MIN) return false;
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_IP_PER_MIN) {
    ipHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  globalHits.push(now);
  if (ipHits.size > 5000) ipHits.clear();
  return true;
}

// Drops items already sent today (same screen + symbol + kind), so a stock that flaps around a
// threshold, or a second open tab / second viewer on the same warm instance, does not repeat it.
export function freshItems(screen, items, now = Date.now()) {
  const day = istDay(now);
  if (day !== sentDay) {
    sentDay = day;
    sentKeys.clear();
  }
  return items.filter((it) => {
    const key = `${screen}|${it.s}|${it.k}`;
    if (sentKeys.has(key)) return false;
    sentKeys.add(key);
    return true;
  });
}

export function buildText(screen, items) {
  return [screen, ...items.map((it) => KINDS[it.k](it.s, it.p))].join('\n');
}

export async function sendTelegram(text) {
  if (!configured()) return { ok: false, reason: 'NOT_CONFIGURED' };
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
  return { ok: true };
}

export function resetTelegramState() {
  ipHits.clear();
  globalHits = [];
  sentDay = '';
  sentKeys.clear();
}
