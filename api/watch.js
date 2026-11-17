import { send, readJson, clientIp } from './_lib/http.js';
import { bearer, verifyToken, loginRequired } from './_lib/auth.js';
import { originAllowed } from './_lib/origin.js';
import { redis, redisConfigured } from './_lib/redis.js';
import { allowRate, cleanScreen } from './_lib/telegram.js';
import { loadWatch, parseScreen, MAX_WATCH } from './_lib/scan.js';

// Lens screens watched by the server-side scanner (alerts even when no browser is open).
// GET    -> { configured, screens, lastScan }
// POST   { action: 'add', name, sector, conditions } | { action: 'remove', name }
export default async function handler(req, res) {
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
