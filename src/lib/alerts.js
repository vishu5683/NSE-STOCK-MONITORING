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

// Server-side watch list (alerts with no browser open). null when the backend is not reachable.
async function watchCall(init) {
  try {
    const res = await fetch('./api/lens', { ...init, headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers || {}) } });
    const body = await res.json().catch(() => null);
    return res.ok ? body : { error: body?.error || `HTTP ${res.status}`, message: body?.message };
  } catch {
    return null;
  }
}
export const getWatch = () => watchCall({ method: 'GET' });
export const watchScreen = (sc) => watchCall({ method: 'POST', body: JSON.stringify({ action: 'add', ...sc }) });
export const unwatchScreen = (name) => watchCall({ method: 'POST', body: JSON.stringify({ action: 'remove', name }) });

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
    body: JSON.stringify({ screen, items: fresh.slice(0, 10).map(({ s, k, p, c }) => ({ s, k, p, c })) }),
  }).catch(() => {});
  return fresh;
}
