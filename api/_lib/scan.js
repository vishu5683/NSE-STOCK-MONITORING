// Server-side Lens alerts: the same rows the browser builds (daily file + live quotes + live intraday
// layer + scores + fundamentals) and the same query engine, run against the screens people chose to
// watch. A stock that newly matches a watched screen is sent to Telegram, browser open or not.
//
// Redis keys
//   lens:watch   hash  name -> { name, sector, conditions, addedAt }
//   lens:last    hash  name -> { key, syms }   last match list, key = sector + query (an edit re-baselines)
//   scan:last    string  summary of the last run (shown in Lens)

import { applyBook, applyIntraday } from '../../src/lib/live.js';
import { analyseAll } from '../../src/lib/signals.js';
import { runQuery, queryText, FIELD_BY_KEY, OPS } from '../../src/lib/lens.js';
import { liveQuotes } from '../quotes.js';
import { getIntraday } from './intraday.js';
import { redis, pipeline, pairsToObject } from './redis.js';
import { cleanScreen, deliver } from './telegram.js';

export const MAX_WATCH = 20;
const MAX_CONDITIONS = 8;

// -> { name, sector, conditions } or { error }
export function parseScreen(body) {
  const name = cleanScreen(body?.name);
  if (!name) return { error: 'BAD_NAME' };
  const sector = body?.sector ? cleanScreen(body.sector) : '';
  const raw = Array.isArray(body?.conditions) ? body.conditions : [];
  const conditions = [];
  for (const c of raw) {
    const value = String(c?.value ?? '').trim();
    if (value === '') continue;
    if (!FIELD_BY_KEY[c?.field] || !OPS[c?.op] || !Number.isFinite(Number(value))) return { error: 'BAD_CONDITION' };
    conditions.push({ field: c.field, op: c.op, value });
  }
  if (!conditions.length || conditions.length > MAX_CONDITIONS) return { error: 'BAD_CONDITION' };
  return { name, sector, conditions };
}

export const screenKey = (sc) => `${sc.sector || ''}|${queryText(sc.conditions)}`;

const shape = (map, asOf) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, { ltp: v.ltp, cp: v.cp, ts: v.t || asOf }]));

export function buildRows(latest, live, intra, screener, fund) {
  const book = applyIntraday(applyBook(latest, live), intra);
  return analyseAll(book.stocks, screener).map((r) => ({ ...r, ...(fund?.[r.s] || {}) }));
}

// Pure: which stocks are new on each screen. lastMap values are JSON strings from Redis.
export function diffScreens(rows, screens, lastMap) {
  const alerts = [];
  const nextLast = {};
  for (const sc of screens) {
    const list = sc.sector ? rows.filter((r) => (r.sector || r.sec) === sc.sector) : rows;
    const syms = runQuery(list, sc.conditions).map((r) => r.s);
    const key = screenKey(sc);
    nextLast[sc.name] = JSON.stringify({ key, syms });
    let prev = null;
    try {
      prev = lastMap[sc.name] ? JSON.parse(lastMap[sc.name]) : null;
    } catch {
      prev = null;
    }
    if (!prev || prev.key !== key) continue; // first run or edited screen: baseline only
    const before = new Set(prev.syms);
    const added = syms.filter((s) => !before.has(s));
    if (added.length) alerts.push({ screen: sc.name, items: added.map((s) => ({ s, k: 'new' })) });
  }
  return { alerts, nextLast };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

export async function loadWatch() {
  const all = pairsToObject(await redis('HGETALL', 'lens:watch'));
  return Object.values(all)
    .map((v) => {
      try {
        return JSON.parse(v);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function runScan(base, now = Date.now()) {
  const screens = await loadWatch();
  const summary = { at: new Date(now).toISOString(), screens: screens.length, alerts: 0, sent: 0, source: null, notes: [] };
  if (screens.length) {
    const [latest, fund, config] = await Promise.all([
      getJson(`${base}/data/latest.json`),
      getJson(`${base}/data/fundamentals.json`).catch(() => null),
      getJson(`${base}/config.json`).catch(() => null),
    ]);
    let live = null;
    try {
      const q = await liveQuotes();
      live = { quotes: shape(q.quotes, q.asOf), indices: shape(q.indices, q.asOf) };
      summary.source = q.source || 'yahoo';
    } catch (e) {
      summary.notes.push(`no live prices: ${e.message}`);
    }
    let intra = null;
    try {
      intra = await getIntraday();
    } catch (e) {
      summary.notes.push(`no intraday layer: ${e.message}`);
    }
    const rows = buildRows(latest, live, intra, config?.screener || {}, fund?.stocks);
    const lastMap = pairsToObject(await redis('HGETALL', 'lens:last'));
    const { alerts, nextLast } = diffScreens(rows, screens, lastMap);
    await pipeline([['DEL', 'lens:last'], ['HSET', 'lens:last', ...Object.entries(nextLast).flat()]]);
    for (const a of alerts) {
      summary.alerts += a.items.length;
      const r = await deliver(a.screen, a.items);
      summary.sent += r.sent;
      if (!r.ok) summary.notes.push(`telegram: ${r.reason}`);
    }
  }
  await redis('SET', 'scan:last', JSON.stringify(summary));
  return summary;
}

// Mon-Fri 09:00-16:00 IST. Outside that the scanner does nothing unless forced.
export function marketWindow(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600 * 1000);
  const day = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 && mins <= 16 * 60;
}
