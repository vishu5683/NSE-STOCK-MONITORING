// Tick-by-tick prices: the browser connects straight to the Upstox V3 market feed (ltpc mode).
// The server only hands out a one-time WebSocket URL (/api/feed-url), so the token stays on the server.
// Ticks are batched and handed over once a second. If the feed fails, the caller keeps polling /api/quotes.
import { decodeFeed } from '../../server/decodeFeed.js';

const FLUSH_MS = 1000;
const MAX_RETRIES = 5;

export function startFeed({ authHeader, onTicks, onStatus }) {
  let ws = null;
  let stopped = false;
  let retries = 0;
  let flushTimer = null;
  let retryTimer = null;
  let keys = {};
  let pending = { quotes: {}, indices: {} };
  let count = 0;

  const flush = () => {
    flushTimer = null;
    if (!count) return;
    const batch = pending;
    pending = { quotes: {}, indices: {} };
    count = 0;
    onTicks(batch);
  };

  const connect = async () => {
    if (stopped) return;
    try {
      const r = await fetch('./api/feed-url', { cache: 'no-store', headers: authHeader || {} });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.url) throw new Error(body.message || `HTTP ${r.status}`);
      keys = body.keys || {};
      if (stopped) return;
      ws = new WebSocket(body.url);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        retries = 0;
        onStatus({ connected: true });
        const list = Object.keys(keys);
        for (let i = 0; i < list.length; i += 100) {
          const msg = { guid: `nsestocks-${Date.now()}-${i}`, method: 'sub', data: { mode: 'ltpc', instrumentKeys: list.slice(i, i + 100) } };
          ws.send(new TextEncoder().encode(JSON.stringify(msg)));
        }
      };
      ws.onmessage = (ev) => {
        const buf = new Uint8Array(ev.data);
        if (!buf.length || buf[0] === 0x7b) return; // JSON control frames
        let decoded;
        try {
          decoded = decodeFeed(buf);
        } catch {
          return;
        }
        const ts = decoded.currentTs ? new Date(decoded.currentTs).toISOString() : new Date().toISOString();
        for (const [key, feed] of Object.entries(decoded.feeds || {})) {
          const t = keys[key];
          const ltp = Number(feed?.ltpc?.ltp);
          if (!t || !(ltp > 0)) continue;
          const q = { ltp, ts };
          const cp = Number(feed?.ltpc?.cp);
          if (cp > 0) q.cp = cp;
          (t[0] === 'i' ? pending.indices : pending.quotes)[t[1]] = q;
          count += 1;
        }
        if (count && !flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
      };
      ws.onclose = () => {
        ws = null;
        onStatus({ connected: false });
        if (stopped) return;
        retries += 1;
        if (retries > MAX_RETRIES) return onStatus({ connected: false, gaveUp: true });
        retryTimer = setTimeout(connect, Math.min(30000, 2000 * 2 ** retries));
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch (err) {
      onStatus({ connected: false, error: err.message });
      retries += 1;
      if (!stopped && retries <= MAX_RETRIES) retryTimer = setTimeout(connect, Math.min(30000, 2000 * 2 ** retries));
      else if (!stopped) onStatus({ connected: false, gaveUp: true });
    }
  };

  connect();
  return () => {
    stopped = true;
    clearTimeout(flushTimer);
    clearTimeout(retryTimer);
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };
}
