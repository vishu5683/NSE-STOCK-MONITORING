// Scheduled messages (cron-job.org, same CRON_SECRET as the scanner):
//   open    ~09:20 IST  to the alert chat: system is running / no session today, watched screens
//   close   ~15:45 IST  to the alert chat: alerts sent today per screen
//   health  ~20:45 IST  to the owner: data checks, NSE comparison, filled stocks, fundamentals age,
//                       Upstox token expiry
import { redis, pairsToObject } from './redis.js';
import { sendTelegram, ownerChat, ownerOnce, istDay } from './telegram.js';
import { loadWatch, sessionToday, getJson } from './scan.js';
import { liveQuotes } from '../quotes.js';
import { getIntraday } from './intraday.js';

const dayLabel = (now) => {
  const d = new Date(now + 5.5 * 3600 * 1000);
  return `${d.toISOString().slice(8, 10)}-${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })}-${d.getUTCFullYear()} (${d.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' })})`;
};

// Upstox analytics tokens are JWTs; exp is in seconds. null when it cannot be read.
export function tokenExpiry(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const exp = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')).exp;
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function tokenWarning(now) {
  const exp = tokenExpiry(process.env.UPSTOX_ANALYTICS_TOKEN);
  if (!exp) return;
  const days = Math.floor((exp - now) / 86_400_000);
  if (days <= 30) {
    await ownerOnce('token-expiry', `⏳ Upstox token ${days < 0 ? 'has expired' : `expires in ${days} day(s)`} (${istDay(exp)}). Live prices fall back to Yahoo until a new UPSTOX_ANALYTICS_TOKEN is set in Vercel.`, now);
  }
}

// The client chat gets Pullback alerts only, so open and close messages are switched off.
// Set DAILY_MESSAGES=on in Vercel to send them again.
const dailyMessagesOn = () => process.env.DAILY_MESSAGES === 'on';

export async function dailyOpen(now = Date.now()) {
  if (!dailyMessagesOn()) {
    await tokenWarning(now).catch(() => {});
    return { ok: true, skipped: 'DAILY_MESSAGES off' };
  }
  const screens = await loadWatch();
  const trading = sessionToday(await getIntraday().catch(() => null), now);
  let source = null;
  try {
    source = (await liveQuotes()).source || 'yahoo';
  } catch {
    source = null;
  }
  let text;
  if (trading === false) {
    text = `🟡 ${dayLabel(now)}: no NSE trading session today (market holiday). Alerts are paused.`;
  } else {
    const names = screens.map((s) => `• ${s.name}`).join('\n');
    text = [
      `✅ ${dayLabel(now)}: NSE Stocks Pro is running.`,
      screens.length ? `Watching ${screens.length} screen(s):\n${names}` : 'No screens are watched yet. Open Lens and press 📡 Watch.',
      `Live prices: ${source === 'upstox' ? 'Upstox (real-time)' : source ? 'Yahoo (backup)' : 'not available right now'}`,
    ].join('\n');
  }
  const r = await sendTelegram(text);
  await tokenWarning(now).catch(() => {});
  return { ok: r.ok, trading, screens: screens.length, source };
}

export async function dailyClose(now = Date.now()) {
  if (!dailyMessagesOn()) return { ok: true, skipped: 'DAILY_MESSAGES off' };
  const trading = sessionToday(await getIntraday().catch(() => null), now);
  if (trading === false) return { ok: true, skipped: 'no session today' };
  const [screens, countsRaw] = await Promise.all([loadWatch(), redis('HGETALL', `alert:count:${istDay(now)}`)]);
  const counts = pairsToObject(countsRaw);
  const total = Object.values(counts).reduce((a, n) => a + Number(n || 0), 0);
  const lines = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, n]) => `• ${name}: ${n}`);
  const text = total
    ? `📊 ${dayLabel(now)} summary: ${total} new match alert(s)\n${lines.join('\n')}`
    : `📊 ${dayLabel(now)} summary: no new matches today on the ${screens.length} watched screen(s).`;
  const r = await sendTelegram(text);
  return { ok: r.ok, total };
}

export async function dailyHealth(base, now = Date.now()) {
  const [latest, fund] = await Promise.all([getJson(`${base}/data/latest.json`), getJson(`${base}/data/fundamentals.json`).catch(() => null)]);
  const m = latest.meta || {};
  const bad = (m.health || []).filter((h) => !h.ok);
  const recon = m.recon;
  const reconLine = !recon
    ? 'NSE check: not run'
    : recon.status === 'ok'
      ? `NSE check (${recon.date}): ✅ ${recon.checked} stocks match the official close/high/low/volume`
      : recon.status === 'pending'
        ? `NSE check (${recon.date}): pending (${recon.note || 'NSE file not posted yet'})`
        : `NSE check (${recon.date}): ❌ ${recon.mismatched} of ${recon.checked} differ\n${(recon.items || []).slice(0, 8).map((i) => `  ${i.s} ${i.field}: ours ${i.ours} vs NSE ${i.nse} (${i.diffPct}%)`).join('\n')}`;
  const fundAge = fund?.asOf ? Math.floor((now - Date.parse(fund.asOf)) / 3_600_000) : null;
  let scan = null;
  try {
    scan = JSON.parse((await redis('GET', 'scan:last')) || 'null');
  } catch {
    scan = null;
  }
  const scanAt = scan?.at ? Date.parse(scan.at) : null;
  // the scanner stops at 15:35 IST, so on a trading day its last run should be from today
  const scanLine = !scanAt
    ? 'Alert scanner: never ran ⚠️'
    : `Alert scanner: last run ${istDay(scanAt)} ${new Date(scanAt + 5.5 * 3600 * 1000).toISOString().slice(11, 16)} IST${scan.ms ? `, ${(scan.ms / 1000).toFixed(1)} s` : ''}${istDay(scanAt) !== istDay(now) ? ' ⚠️ not today' : ''}${scan.notes?.length ? `\n  ${scan.notes.slice(0, 4).join('\n  ')}` : ''}`;
  const text = [
    `🩺 Data health, ${dayLabel(now)}`,
    `Data file: ${m.generatedAtIST || '?'}, session ${m.lastTradingDate || '?'}`,
    reconLine,
    bad.length ? `Checks failing:\n${bad.map((h) => `  ❌ ${h.name}: ${h.detail}`).join('\n')}` : 'All data checks: ✅',
    m.filledFromNse?.length ? `Filled from NSE (Yahoo was late): ${m.filledFromNse.length}` : null,
    `Fundamentals: ${fund?.asOf ? `${fund.ok} stocks, ${fundAge} h old${fundAge > 30 ? ' ⚠️' : ''}` : 'missing ⚠️'}`,
    scanLine,
  ].filter(Boolean).join('\n');
  const r = await sendTelegram(text, ownerChat());
  await tokenWarning(now).catch(() => {});
  return { ok: r.ok, failing: bad.length, recon: recon?.status || null };
}
