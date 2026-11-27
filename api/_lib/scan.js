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
import { liveFutures } from './upstoxOi.js';
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

// The Pullback alert runs from this fixed screen, not from the Lens watch list, so editing or
// removing a watched screen in the browser cannot stop it.
const PULLBACK_PRESET = PRESETS.find((p) => isPullbackScreen(p.name));
// Only the PULLBACK_TOP matches with the highest value traded today are alerted.
export const PULLBACK_TOP = 15;
export const PULLBACK_SCREEN = { name: PULLBACK_PRESET.name, sector: '', top: PULLBACK_TOP, conditions: PULLBACK_PRESET.conditions.map((c) => ({ field: c.field, op: c.op, value: String(c.value) })) };

// A watched screen counts as Pullback by its name, or by the preset's query under any name.
export const telegramScreen = (sc) => isPullbackScreen(sc.name) || (PULLBACK_QUERY !== '' && queryText(sc.conditions) === PULLBACK_QUERY);

const shape = (map, asOf) => Object.fromEntries(Object.entries(map || {}).map(([k, v]) => [k, { ltp: v.ltp, cp: v.cp, ts: v.t || asOf }]));

export function buildRows(latest, live, intra, screener, fund) {
  const book = applyIntraday(applyBook(latest, live), intra);
  return analyseAll(book.stocks, screener).map((r) => ({ ...r, ...(fund?.[r.s] || {}) }));
}

// Pure: which stocks are new on each screen. lastMap values are JSON strings from Redis.
// held symbols are left out without letting a lower-ranked stock take their place.
export function diffScreens(rows, screens, lastMap, day = istDay(), held = new Set()) {
  const bySym = new Map(rows.map((r) => [r.s, r]));
  const alerts = [];
  const nextLast = {};
  for (const sc of screens) {
    const list = sc.sector ? rows.filter((r) => (r.sector || r.sec) === sc.sector) : rows;
    let matches = runQuery(list, sc.conditions);
    if (sc.top) matches = matches.filter((r) => turnoverNow(r) > 0).sort((a, b) => turnoverNow(b) - turnoverNow(a)).slice(0, sc.top);
    const syms = matches.map((r) => r.s).filter((s) => !held.has(s));
    const key = `${screenKey(sc)}${sc.top ? `|top${sc.top}` : ''}`;
    nextLast[sc.name] = JSON.stringify({ key, day, syms });
    let prev = null;
    try {
      prev = lastMap[sc.name] ? JSON.parse(lastMap[sc.name]) : null;
    } catch {
      prev = null;
    }
    // first scan of the day, first run or edited screen: baseline only, so the open does not resend yesterday's list
    if (!prev || prev.key !== key || prev.day !== day) continue;
    const before = new Set(prev.syms);
    const added = syms.filter((s) => !before.has(s));
    if (added.length) {
      alerts.push({
        screen: sc.name,
        detail: sc.top ? `New in the top ${sc.top} Pullback stocks by value traded today` : `${sc.sector ? `${sc.sector}: ` : ''}${queryText(sc.conditions)}`,
        items: added.map((s) => ({ s, k: 'new', p: bySym.get(s)?.ltp ?? null, c: bySym.get(s)?.chg ?? null })),
      });
    }
  }
  return { alerts, nextLast };
}

// Most Active Equities (NSE Market Data page): top stocks by value traded today. A stock that newly
// enters the top list is sent to Telegram; the first scan of the day only sets the baseline.
// liveValueCr (Upstox day volume x VWAP) moves every scan; dayValueCr from the 5-minute bars is the fallback.
export const turnoverNow = (r) => (Number.isFinite(r.liveValueCr) ? r.liveValueCr : r.dayValueCr);

export function withLiveTurnover(rows, quotes) {
  return rows.map((r) => {
    const vol = quotes?.[r.s]?.vol;
    const px = r.vwap || r.ltp;
    return vol > 0 && px > 0 ? { ...r, liveValueCr: Math.round((px * vol) / 1e5) / 100 } : r;
  });
}
export const ACTIVE_SCREEN = 'Most Active Equities';
export const ACTIVE_TOP = 15;

// Pure: top ACTIVE_TOP of list by value, and which names are new since the last scan today.
export function diffTop(list, prevJson, day) {
  const top = list.filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, ACTIVE_TOP);
  const next = JSON.stringify({ day, syms: top.map((x) => x.s) });
  let prev = null;
  try {
    prev = prevJson ? JSON.parse(prevJson) : null;
  } catch {
    prev = null;
  }
  if (!prev || prev.day !== day) return { items: [], next };
  const before = new Set(prev.syms);
  const items = top.filter((x) => !before.has(x.s)).map((x) => ({ s: x.s, k: 'new', p: x.p ?? null, c: x.c ?? null }));
  return { items, next };
}

export const diffActive = (rows, prevJson, day) =>
  diffTop(rows.map((r) => ({ s: r.s, value: turnoverNow(r), p: r.ltp, c: r.chg })), prevJson, day);

// Volume Gainers (NSE Market Data page): today's volume against the 20-day average volume.
// Only stocks trading at least VOLGAIN_MIN times their average are ranked.
export const VOLGAIN_SCREEN = 'Volume Gainers';
export const VOLGAIN_MIN = 2;

export function volumeGainers(rows, quotes) {
  return rows.map((r) => {
    const vol = quotes?.[r.s]?.vol;
    const ratio = vol > 0 && r.avgVol20 > 0 ? vol / r.avgVol20 : 0;
    return { s: r.s, value: ratio >= VOLGAIN_MIN ? Math.round(ratio * 100) / 100 : 0, p: r.ltp, c: r.chg };
  });
}

// Most Active Future Contracts: near-month futures by value traded today (price x quantity).
export const FUT_SCREEN = 'Most Active Future Contracts';

export function futuresList(futs) {
  return Object.entries(futs || {}).map(([name, f]) => ({
    s: `${name} FUT`,
    value: f.futLive > 0 && f.futVolLive > 0 ? (f.futLive * f.futVolLive) / 1e7 : 0,
    p: f.futLive,
    c: f.futCp > 0 ? Math.round((f.futLive / f.futCp - 1) * 10000) / 100 : null,
  }));
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

// Every source is fetched in parallel and each alert type stands alone, so one slow or failed
// source (Yahoo intraday, the data file, Upstox futures) never holds back the others.
export async function runScan(base, now = Date.now()) {
  const started = Date.now();
  const summary = { at: new Date(now).toISOString(), screens: 0, alerts: 0, sent: 0, held: 0, source: null, notes: [] };
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const why = (r) => (r.status === 'rejected' ? r.reason?.message || String(r.reason) : null);
  const [, latestR, fundR, configR, quotesR, intraR, futR, lastR, activeR, futLastR, volR] = await Promise.allSettled([
    loadWatch(),
    getJson(`${base}/data/latest.json`),
    getJson(`${base}/data/fundamentals.json`),
    getJson(`${base}/config.json`),
    liveQuotes(),
    getIntraday(),
    liveFutures(process.env.UPSTOX_ANALYTICS_TOKEN, now),
    redis('HGETALL', 'lens:last'),
    redis('GET', 'active:last'),
    redis('GET', 'futactive:last'),
    redis('GET', 'volgain:last'),
  ]);
  const screens = [PULLBACK_SCREEN];
  summary.screens = screens.length;
  const latest = val(latestR);
  const intra = val(intraR);
  if (!latest) summary.notes.push(`data file: ${why(latestR)}`);
  if (!intra) summary.notes.push(`intraday: ${why(intraR)}`);

  let live = null;
  let rawQuotes = null;
  const q = val(quotesR);
  if (q) {
    rawQuotes = q.quotes;
    live = { quotes: shape(q.quotes, q.asOf), indices: shape(q.indices, q.asOf) };
    summary.source = q.source || 'yahoo';
    if (summary.source !== 'upstox') await ownerOnce('upstox-down', `⚠️ Upstox is not answering; live prices come from Yahoo (backup).\n${q.fallbackReason || ''}`.trim(), now).catch(() => {});
  } else summary.notes.push(`live prices: ${why(quotesR)}`);

  if (sessionToday(intra, now) === false) {
    summary.noSession = true; // NSE holiday: keep the baselines as they are
  } else {
    const day = istDay(now);
    const alerts = [];
    const writes = [];

    const futs = val(futR);
    if (futs) {
      const fut = diffTop(futuresList(futs), val(futLastR), day);
      writes.push(['SET', 'futactive:last', fut.next]);
      if (fut.items.length) alerts.push({ screen: FUT_SCREEN, detail: `New in the top ${ACTIVE_TOP} near-month futures by value traded today`, items: fut.items });
    } else if (process.env.UPSTOX_ANALYTICS_TOKEN) summary.notes.push(`futures: ${why(futR)}`);

    if (latest) {
      let rows = buildRows(latest, live, intra, val(configR)?.screener || {}, val(fundR)?.stocks);

      rows = withLiveTurnover(rows, rawQuotes);
      const active = diffActive(rows, val(activeR), day);
      writes.push(['SET', 'active:last', active.next]);
      if (active.items.length) alerts.push({ screen: ACTIVE_SCREEN, detail: `New in the top ${ACTIVE_TOP} by value traded today`, items: active.items });

      if (rawQuotes) {
        const gain = diffTop(volumeGainers(rows, rawQuotes), val(volR), day);
        writes.push(['SET', 'volgain:last', gain.next]);
        if (gain.items.length) alerts.push({ screen: VOLGAIN_SCREEN, detail: `New in the top ${ACTIVE_TOP} by volume vs 20-day average (at least ${VOLGAIN_MIN}x)`, items: gain.items });
      }

      const lastMap = pairsToObject(val(lastR));
      let { alerts: screenAlerts, nextLast } = diffScreens(rows, screens, lastMap, day);
      const toTelegram = new Set(screens.filter(telegramScreen).map((sc) => sc.name));
      const candidates = [...new Set(screenAlerts.filter((a) => toTelegram.has(a.screen)).flatMap((a) => a.items.map((i) => i.s)))];
      if (candidates.length && summary.source === 'upstox') {
        try {
          const gaps = divergent(live.quotes, await yahooQuotesFor(candidates, now), now);
          if (gaps.length) {
            const held = new Set(gaps.map((g) => g.s));
            summary.held = held.size;
            ({ alerts: screenAlerts, nextLast } = diffScreens(rows, screens, lastMap, day, held));
            const lines = gaps.slice(0, 10).map((g) => `• ${g.s}: Upstox ${g.upstox} vs Yahoo ${g.yahoo} (${g.gap}%)`);
            await ownerOnce(`gap:${gaps.map((g) => g.s).sort().join(',')}`, `⚠️ Price check: alert held back, sources disagree by more than ${CROSS_CHECK_PCT}%\n${lines.join('\n')}`, now).catch(() => {});
          }
        } catch (e) {
          summary.notes.push(`cross-check skipped: ${e.message}`);
        }
      }
      writes.push(['DEL', 'lens:last']);
      if (Object.keys(nextLast).length) writes.push(['HSET', 'lens:last', ...Object.entries(nextLast).flat()]);
      alerts.push(...screenAlerts.filter((a) => toTelegram.has(a.screen)));
    }

    await Promise.all([
      writes.length ? pipeline(writes) : null,
      ...alerts.map(async (a) => {
        summary.alerts += a.items.length;
        const r = await deliver(a.screen, a.items, a.detail, true);
        summary.sent += r.sent;
        if (!r.ok) summary.notes.push(`telegram: ${r.reason}`);
      }),
    ]);
  }
  summary.ms = Date.now() - started;
  await redis('SET', 'scan:last', JSON.stringify(summary));
  // the owner hears about a broken source once a day per source, not every minute
  for (const n of summary.notes) {
    const src = n.split(':')[0];
    if (['data file', 'live prices', 'futures', 'telegram'].includes(src)) await ownerOnce(`scan:${src}`, `⚠️ Alert scanner: ${n}`, now).catch(() => {});
  }
  return summary;
}

// Mon-Fri 09:15-15:35 IST (pre-open prices are not scanned). Outside that the scanner does nothing unless forced.
export function marketWindow(now = Date.now()) {
  const d = new Date(now + 5.5 * 3600 * 1000);
  const day = d.getUTCDay();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 35;
}
