import { send, readJson, clientIp } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { originAllowed } from './_lib/origin.js';
import { redis, redisConfigured } from './_lib/redis.js';
import { allowRate, cleanScreen } from './_lib/telegram.js';
import { loadWatch, parseScreen, runScan, marketWindow, MAX_WATCH } from './_lib/scan.js';
import { dailyOpen, dailyClose, dailyHealth } from './_lib/daily.js';

// One function for server-side Lens alerts (Vercel Hobby allows 12 functions per deployment).
// Scheduler calls (cron-job.org) carry "Authorization: Bearer <CRON_SECRET>":
//   GET  /api/lens?scan=1[&force=1]   scanner, every minute, Mon-Fri 09:15-15:35 IST only
//   GET  /api/lens?daily=open         ~09:20 IST, system running / holiday message
//   GET  /api/lens?daily=close        ~15:45 IST, day summary
//   GET  /api/lens?daily=health       ~20:45 IST, data health report to the owner
// Browser:
//   GET  /api/lens                    { configured, screens, lastScan }
//   POST /api/lens                    { action: 'add', name, sector, conditions } | { action: 'remove', name }
const fromScheduler = (req) => Boolean(process.env.CRON_SECRET) && req.headers?.authorization === `Bearer ${process.env.CRON_SECRET}`;

async function daily(req, res, which) {
  if (!fromScheduler(req)) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Only the scheduler may call this.' });
  if (!redisConfigured()) return send(res, 503, { error: 'REDIS_NOT_CONFIGURED' });
  try {
    if (which === 'open') return send(res, 200, await dailyOpen());
    if (which === 'close') return send(res, 200, await dailyClose());
    if (which === 'health') return send(res, 200, await dailyHealth(`https://${req.headers.host}`));
    return send(res, 400, { error: 'BAD_DAILY' });
  } catch (err) {
    return send(res, 502, { error: 'DAILY_FAILED', message: err.message });
  }
}

async function scan(req, res) {
  if (!fromScheduler(req)) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Only the scheduler may call this.' });
  if (!redisConfigured()) return send(res, 503, { error: 'REDIS_NOT_CONFIGURED', message: 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.' });
  const force = /[?&]force=1\b/.test(req.url || '');
  if (!force && !marketWindow()) return send(res, 200, { ok: true, skipped: 'outside market hours' });
  try {
    return send(res, 200, { ok: true, ...(await runScan(`https://${req.headers.host}`)) });
  } catch (err) {
    return send(res, 502, { error: 'SCAN_FAILED', message: err.message });
  }
}

async function watch(req, res) {
  if (!originAllowed(req)) return send(res, 403, { error: 'FORBIDDEN_ORIGIN' });
  if (loginRequired() && !verifyToken(bearer(req))) return send(res, 401, { error: 'UNAUTHORIZED' });
  if (!redisConfigured()) return send(res, 200, { configured: false, screens: [] });
  try {
    if (req.method === 'GET') {
      const [screens, last] = await Promise.all([loadWatch(), redis('GET', 'scan:last')]);
      let lastScan = null;
      try {
        lastScan = last ? JSON.parse(last) : null;
      } catch {
        lastScan = null;
      }
      return send(res, 200, { configured: true, screens, lastScan });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    if (!allowRate(clientIp(req))) return send(res, 429, { error: 'RATE_LIMITED' });

    const body = await readJson(req, 4096);
    if (body?.action === 'remove') {
      const name = cleanScreen(body.name);
      if (!name) return send(res, 400, { error: 'BAD_NAME' });
      await redis('HDEL', 'lens:watch', name);
      await redis('HDEL', 'lens:last', name);
      return send(res, 200, { ok: true, screens: await loadWatch() });
    }
    if (body?.action !== 'add') return send(res, 400, { error: 'BAD_ACTION' });
    const sc = parseScreen(body);
    if (sc.error) return send(res, 400, { error: sc.error });
    const current = await loadWatch();
    if (!current.some((x) => x.name === sc.name) && current.length >= MAX_WATCH) return send(res, 400, { error: 'TOO_MANY', message: `At most ${MAX_WATCH} watched screens.` });
    await redis('HSET', 'lens:watch', sc.name, JSON.stringify({ ...sc, addedAt: new Date().toISOString() }));
    await redis('HDEL', 'lens:last', sc.name); // new or edited: the next scan sets the baseline
    return send(res, 200, { ok: true, screens: await loadWatch() });
  } catch (err) {
    return send(res, 502, { error: 'REDIS', message: err.message });
  }
}

export default function handler(req, res) {
  const q = new URL(req.url || '/', 'http://local').searchParams;
  if (req.method === 'GET' && q.get('daily')) return daily(req, res, q.get('daily'));
  if (req.method === 'GET' && q.get('scan') === '1') return scan(req, res);
  return watch(req, res);
}
