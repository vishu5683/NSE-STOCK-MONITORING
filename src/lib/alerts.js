import { authHeader } from './liveApi.js';

// One alert per screen + symbol + kind per day, shared by every tab of this browser through
// localStorage, so a stock that flaps around a threshold or a second open tab does not repeat it.
// The server keeps the same rule for other viewers.
const SENT_KEY = 'nsestocks.alertSent';

const istDay = (now = Date.now()) => new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function readSent(day) {
  try {
    const v = JSON.parse(localStorage.getItem(SENT_KEY) || 'null');
    return v && v.day === day && Array.isArray(v.keys) ? v.keys : [];
  } catch {
    return [];
  }
}

function writeSent(day, keys) {
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify({ day, keys: keys.slice(-2000) }));
  } catch {
    /* storage blocked: the server-side dedupe still applies */
  }
}

// items: [{ s, k, p?, text, tone }] -> the ones not yet sent today (also posted to Telegram)
export function dispatchAlerts(screen, items, now = Date.now()) {
  const day = istDay(now);
  const sent = readSent(day);
  const seen = new Set(sent);
  const fresh = items.filter((it) => {
    const key = `${screen}|${it.s}|${it.k}`;
    if (seen.has(key)) return false;
    seen.add(key);
    sent.push(key);
    return true;
  });
  if (!fresh.length) return fresh;
  writeSent(day, sent);
  fetch('./api/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify({ screen, items: fresh.slice(0, 10).map(({ s, k, p }) => ({ s, k, p })) }),
  }).catch(() => {});
  return fresh;
}
