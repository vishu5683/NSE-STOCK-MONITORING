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
import { runQuery, queryText, FIELD_BY_KEY, OPS, PRESETS } from '../../src/lib/lens.js';
import { liveQuotes } from '../quotes.js';
import { getIntraday } from './intraday.js';
import { yahooQuotesFor } from './yahoo.js';
import { redis, pipeline, pairsToObject } from './redis.js';
import { cleanScreen, deliver, ownerOnce, istDay, isPullbackScreen } from './telegram.js';

export const MAX_WATCH = 20;
const MAX_CONDITIONS = 8;
const CROSS_CHECK_PCT = 1; // Upstox vs Yahoo price gap that holds an alert back
const CROSS_CHECK_FRESH_MS = 3 * 60_000;

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

const PULLBACK_QUERY = queryText(PRESETS.find((p) => isPullbackScreen(p.name))?.conditions || []);

// A watched screen counts as Pullback by its name, or by the preset's query under any name.
export const telegramScreen = (sc) => isPullbackScreen(sc.name) || (PULLBACK_QUERY !== '' && queryText(sc.conditions) === PULLBACK_QUERY);

const shape = (map, asOf) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, { ltp: v.ltp, cp: v.cp, ts: v.t || asOf }]));

export function buildRows(latest, live, intra, screener, fund) {
  const book = applyIntraday(applyBook(latest, live), intra);
  return analyseAll(book.stocks, screener).map((r) => ({ ...r, ...(fund?.[r.s] || {}) }));
}

// Pure: which stocks are new on each screen. lastMap values are JSON strings from Redis.
export function diffScreens(rows, screens, lastMap) {
  const bySym = new Map(rows.map((r) => [r.s, r]));
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
    if (added.length) {
      alerts.push({
        screen: sc.name,
        detail: `${sc.sector ? `${sc.sector}: ` : ''}${queryText(sc.conditions)}`,
        items: added.map((s) => ({ s, k: 'new', p: bySym.get(s)?.ltp ?? null, c: bySym.get(s)?.chg ?? null })),
      });
    }
  }
  return { alerts, nextLast };
}

// Upstox price vs a fresh Yahoo price for the symbols about to be alerted. A gap above
// CROSS_CHECK_PCT holds that alert back (it is re-checked on the next scan).
export function divergent(liveQuotesMap, yahoo, now = Date.now()) {
  const out = [];
  for (const [s, y] of Object.entries(yahoo || {})) {
    const u = liveQuotesMap?.[s]?.ltp;
    if (!u || !y?.ltp || !y.t || now - Date.parse(y.t) > CROSS_CHECK_FRESH_MS) continue;
    const gap = Math.abs(u / y.ltp - 1) * 100;
    if (gap > CROSS_CHECK_PCT) out.push({ s, upstox: u, yahoo: y.ltp, gap: Math.round(gap * 100) / 100 });
  }
  return out;
}

// Newest 5-minute bar across all stocks -> was there an NSE session today?
export function sessionToday(intra, now = Date.now()) {
  const times = Object.values(intra?.stocks || {}).map((x) => x?.iAt).filter(Boolean).sort();
  if (!times.length) return null; // unknown
  return istDay(Date.parse(times[times.length - 1])) === istDay(now);
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}
export { getJson };

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
  const summary = { at: new Date(now).toISOString(), screens: screens.length, alerts: 0, sent: 0, held: 0, source: null, notes: [] };
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
      if (summary.source !== 'upstox') await ownerOnce('upstox-down', `⚠️ Upstox is not answering; live prices come from Yahoo (backup).\n${q.fallbackReason || ''}`.trim(), now).catch(() => {});
    } catch (e) {
      summary.notes.push(`no live prices: ${e.message}`);
    }
    let intra = null;
    try {
      intra = await getIntraday();
    } catch (e) {
      summary.notes.push(`no intraday layer: ${e.message}`);
    }
    if (sessionToday(intra, now) === false) {
      summary.noSession = true; // NSE holiday: keep the baseline as it is
    } else {
      let rows = buildRows(latest, live, intra, config?.screener || {}, fund?.stocks);
      const lastMap = pairsToObject(await redis('HGETALL', 'lens:last'));
      let { alerts, nextLast } = diffScreens(rows, screens, lastMap);
      const candidates = [...new Set(alerts.flatMap((a) => a.items.map((i) => i.s)))];
      if (candidates.length && summary.source === 'upstox') {
        try {
          const gaps = divergent(live.quotes, await yahooQuotesFor(candidates, now), now);
          if (gaps.length) {
            const held = new Set(gaps.map((g) => g.s));
            summary.held = held.size;
            rows = rows.filter((r) => !held.has(r.s));
            ({ alerts, nextLast } = diffScreens(rows, screens, lastMap));
            const lines = gaps.slice(0, 10).map((g) => `• ${g.s}: Upstox ${g.upstox} vs Yahoo ${g.yahoo} (${g.gap}%)`);
            await ownerOnce(`gap:${gaps.map((g) => g.s).sort().join(',')}`, `⚠️ Price check: alert held back, sources disagree by more than ${CROSS_CHECK_PCT}%\n${lines.join('\n')}`, now).catch(() => {});
          }
        } catch (e) {
          summary.notes.push(`cross-check skipped: ${e.message}`);
        }
      }
      await pipeline([['DEL', 'lens:last'], ['HSET', 'lens:last', ...Object.entries(nextLast).flat()]]);
      const toTelegram = new Set(screens.filter(telegramScreen).map((sc) => sc.name));
      for (const a of alerts) {
        if (!toTelegram.has(a.screen)) continue;
        summary.alerts += a.items.length;
        const r = await deliver(a.screen, a.items, a.detail, true);
        summary.sent += r.sent;
        if (!r.ok) summary.notes.push(`telegram: ${r.reason}`);
      }
    }
  }
  await redis('SET', 'scan:last', JSON.stringify(summary));
  return summary;
}

// Mon-Fri 09:15-15:35 IST (pre-open prices are not scanned). Outside that the scanner does nothing unless forced.
export function marketWindow(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600 * 1000);
  const day = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 35;
}
