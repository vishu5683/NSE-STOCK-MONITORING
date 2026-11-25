// Telegram alerts. The bot token and chat ids are Vercel env vars only.
//
// TELEGRAM_BOT_TOKEN       token from @BotFather
// TELEGRAM_CHAT_ID         chat that gets alerts, morning check and day summary (client / group)
// TELEGRAM_OWNER_CHAT_ID   optional: data-health and system warnings (defaults to TELEGRAM_CHAT_ID)
//
// The browser never sends message text: it sends a screen name and {symbol, kind, price, change},
// the symbols must be in the instrument map, and the text is built here. So a caller who finds the
// URL cannot post arbitrary text (links, phishing) to the client's chat.

import instruments from '../_instruments.json' with { type: 'json' };
import { redisConfigured, pipeline } from './redis.js';

const SYMBOLS = new Set(Object.keys(instruments.stocks || {}));
const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (p) => (p ? ` ₹${inr.format(p)}` : '');
const change = (c) => (c === null || c === undefined ? '' : ` (${c > 0 ? '+' : ''}${c.toFixed(2)}%)`);
const KINDS = {
  new: (it) => `• ${it.s}${money(it.p)}${change(it.c)}`,
  bull: (it) => `• ${it.s}: bullish setup${money(it.p)}${change(it.c)}`,
  bear: (it) => `• ${it.s}: bearish setup${money(it.p)}${change(it.c)}`,
  buy: (it) => `• ${it.s}: intraday BUY${money(it.p)}${change(it.c)}`,
  sell: (it) => `• ${it.s}: intraday SELL${money(it.p)}${change(it.c)}`,
  orb_up: (it) => `• ${it.s}: broke above opening range${money(it.p)}${change(it.c)}`,
  orb_down: (it) => `• ${it.s}: broke below opening range${money(it.p)}${change(it.c)}`,
};
const MAX_ITEMS = 10;
const PER_IP_PER_MIN = 10;
const GLOBAL_PER_10_MIN = 60;

const ipHits = new Map(); // ip -> [ms]
let globalHits = [];
let sentDay = '';
const sentKeys = new Set(); // `${screen}|${s}|${kind}` already sent today (no Redis)

export function configured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export const mainChat = () => process.env.TELEGRAM_CHAT_ID;
export const ownerChat = () => process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

export const istDay = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
export const istTime = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(11, 16);

export function cleanScreen(v) {
  const s = String(v ?? '').replace(/[^A-Za-z0-9 +&/().%,-]/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, 60);
}

const finite = (x, lo, hi) => (typeof x === 'number' && Number.isFinite(x) && x > lo && x < hi ? Math.round(x * 100) / 100 : null);

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
    items.push({ s, k, p: finite(it.p, 0, 1e7), c: finite(it.c, -100, 100) });
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

// Drops items already sent today (same screen + symbol + kind). With Redis the list is shared by
// every viewer, every function instance and the server-side scanner; without it, per warm instance.
export async function freshItems(screen, items, now = Date.now()) {
  if (!redisConfigured()) return freshItemsLocal(screen, items, now);
  const key = `alert:sent:${istDay(now)}`;
  const added = await pipeline([...items.map((it) => ['SADD', key, `${screen}|${it.s}|${it.k}`]), ['EXPIRE', key, 172800]]);
  return items.filter((_, i) => added[i] === 1);
}

export function freshItemsLocal(screen, items, now = Date.now()) {
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

// detail: optional server-built line under the screen name (e.g. the query), never browser text
export function buildText(screen, items, detail = '', now = Date.now()) {
  return [`📡 ${screen}`, ...(detail ? [detail] : []), ...items.map((it) => KINDS[it.k](it)), `🕒 ${istTime(now)} IST`].join('\n');
}

export async function sendTelegram(text, chatId = mainChat()) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) return { ok: false, reason: 'NOT_CONFIGURED' };
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
  return { ok: true };
}

// The client chat gets Pullback alerts only (client's choice, 25-Nov-2026). Other screens and
// panels still run in the app; they just do not post to Telegram.
export const isPullbackScreen = (screen) => /pull\s*-?\s*back/i.test(String(screen || ''));

// Dedupe, send in messages of at most 10 lines, count per screen for the day summary.
// allowed: the caller has already matched the screen to the Pullback query (renamed screen).
export async function deliver(screen, items, detail = '', allowed = false) {
  if (!allowed && !isPullbackScreen(screen)) return { ok: true, sent: 0, skipped: 'NOT_PULLBACK' };
  const fresh = await freshItems(screen, items);
  let sent = 0;
  for (let i = 0; i < fresh.length; i += MAX_ITEMS) {
    const part = fresh.slice(i, i + MAX_ITEMS);
    const r = await sendTelegram(buildText(screen, part, detail));
    if (!r.ok) return { ok: false, reason: r.reason, sent };
    sent += part.length;
  }
  if (sent && redisConfigured()) {
    const key = `alert:count:${istDay()}`;
    await pipeline([['HINCRBY', key, screen, sent], ['EXPIRE', key, 259200]]).catch(() => {});
  }
  return { ok: true, sent };
}

// A system warning to the owner, at most once per key per day.
export async function ownerOnce(key, text, now = Date.now()) {
  if (redisConfigured()) {
    const k = `owner:sent:${istDay(now)}`;
    const [added] = await pipeline([['SADD', k, key], ['EXPIRE', k, 172800]]);
    if (added !== 1) return { ok: true, skipped: true };
  }
  return sendTelegram(text, ownerChat());
}

export function resetTelegramState() {
  ipHits.clear();
  globalHits = [];
  sentDay = '';
  sentKeys.clear();
}
