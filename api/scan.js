import { send } from './_lib/http.js';
import { redisConfigured } from './_lib/redis.js';
import { runScan, marketWindow } from './_lib/scan.js';

// Called every 2 minutes by an external scheduler (cron-job.org) with
// "Authorization: Bearer <CRON_SECRET>" -- the same secret Vercel Cron uses for /api/cron-refresh.
// Does nothing outside Mon-Fri 09:00-16:00 IST unless ?force=1.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Only the scheduler may call this.' });
  if (!redisConfigured()) return send(res, 503, { error: 'REDIS_NOT_CONFIGURED', message: 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.' });
  const force = /[?&]force=1\b/.test(req.url || '');
  if (!force && !marketWindow()) return send(res, 200, { ok: true, skipped: 'outside market hours' });
  try {
    const base = `https://${req.headers.host}`;
    return send(res, 200, { ok: true, ...(await runScan(base)) });
  } catch (err) {
    return send(res, 502, { error: 'SCAN_FAILED', message: err.message });
  }
}
