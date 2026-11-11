// Local-only Upstox live prices. The access token stays in .upstox-token.json.
// The browser only receives last price and previous close. Never send the token out.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadEnv } from 'vite';
import { decodeFeed } from './decodeFeed.js';

const INDEXES = [
  { name: 'NIFTY 50', fallback: 'NSE_INDEX|Nifty 50', match: (r) => r.segment === 'NSE_INDEX' && norm(r.name) === 'nifty 50' },
  { name: 'BANK NIFTY', fallback: 'NSE_INDEX|Nifty Bank', match: (r) => r.segment === 'NSE_INDEX' && norm(r.name) === 'nifty bank' },
  { name: 'INDIA VIX', fallback: 'NSE_INDEX|India VIX', match: (r) => r.segment === 'NSE_INDEX' && norm(r.name) === 'india vix' },
  { name: 'SENSEX', fallback: 'BSE_INDEX|SENSEX', match: (r) => r.segment === 'BSE_INDEX' && (norm(r.name) === 'sensex' || norm(r.trading_symbol) === 'sensex') },
];

const state = {
  configured: false,
  authed: false,
  connected: false,
  message: 'Starting Upstox feed…',
  updatedAt: null,
  mapped: 0,
  unmapped: [],
  quotes: {},
  indices: {},
};

const clients = new Set();
let root = '';
let apiKey = '';
let apiSecret = '';
let redirectUri = 'http://127.0.0.1:5173/api/upstox/callback';
let keyToRow = new Map();
let ws = null;
let started = false;
let stopped = false;
let pendingState = '';
let publishTimer = null;
const norm = (v) => String(v || '').trim().toLowerCase();
function canon(key) {
  const s = String(key || '');
  const colon = s.indexOf(':');
  const pipe = s.indexOf('|');
  if (colon >= 0 && (pipe < 0 || colon < pipe)) return `${s.slice(0, colon)}|${s.slice(colon + 1)}`;
  return s;
}
function stamp(currentTs) {
  const n = Number(currentTs);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = n > 1e14 ? Math.round(n / 1000) : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tokenPath() {
  return path.join(root, '.upstox-token.json');
}

function readToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(tokenPath(), 'utf8'));
    return typeof raw.access_token === 'string' && raw.access_token ? raw.access_token : '';
  } catch {
    return '';
  }
}

function writeToken(accessToken) {
  fs.writeFileSync(tokenPath(), JSON.stringify({ access_token: accessToken, savedAt: new Date().toISOString() }));
}

function dropToken() {
  try {
    fs.rmSync(tokenPath(), { force: true });
  } catch {
    /* ignore */
  }
}

function publicState() {
  return {
    configured: state.configured,
    authed: state.authed,
    connected: state.connected,
    message: state.message,
    updatedAt: state.updatedAt,
    mapped: state.mapped,
    unmapped: state.unmapped,
    quotes: state.quotes,
    indices: state.indices,
  };
}

function publish() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function schedulePublish() {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    publish();
  }, 400);
}

function universeSymbols() {
  const text = fs.readFileSync(path.join(root, 'data-pipeline', 'universe.csv'), 'utf8');
  return text
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(',')[0].trim())
    .filter(Boolean);
}

async function loadExchange(name) {
  const dir = path.join(root, 'data-pipeline', 'cache');
  const file = path.join(dir, `${name}.json`);
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 12 * 60 * 60 * 1000;
  if (!fresh) {
    const res = await fetch(`https://assets.upstox.com/market-quote/instruments/exchange/${name}.json.gz`);
    if (!res.ok) throw new Error(`Could not download Upstox ${name} instruments (HTTP ${res.status}).`);
    const json = zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, json);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function ensureMap() {
  if (keyToRow.size) return;
  const [nse, bse] = await Promise.all([loadExchange('NSE'), loadExchange('BSE')]);
  const bySymbol = new Map();
  for (const row of nse) {
    if (row.segment === 'NSE_EQ' && row.instrument_type === 'EQ' && row.trading_symbol && row.instrument_key) {
      bySymbol.set(row.trading_symbol, row.instrument_key);
    }
  }
  const next = new Map();
  const unmapped = [];
  for (const sym of universeSymbols()) {
    const key = bySymbol.get(sym);
    if (!key) unmapped.push(sym);
    else next.set(canon(key), { kind: 'stock', symbol: sym });
  }
  const all = nse.concat(bse);
  for (const spec of INDEXES) {
    const found = all.find(spec.match);
    const key = found?.instrument_key || spec.fallback;
    next.set(canon(key), { kind: 'index', name: spec.name });
    console.log(`[upstox] ${spec.name} -> ${key}`);
  }
  keyToRow = next;
  state.mapped = universeSymbols().length - unmapped.length;
  state.unmapped = unmapped.slice(0, 12);
  console.log(`[upstox] mapped ${state.mapped} stocks, ${unmapped.length} missing`);
}

function remember(key, ltp, cp, ts) {
  if (!Number.isFinite(ltp) || ltp <= 0) return false;
  const target = keyToRow.get(canon(key));
  if (!target) return false;
  const quote = { ltp, ts };
  if (Number.isFinite(cp) && cp > 0) quote.cp = cp;
  if (target.kind === 'index') state.indices[target.name] = quote;
  else state.quotes[target.symbol] = quote;
  state.updatedAt = ts;
  return true;
}

async function snapshot(token) {
  const keys = [...keyToRow.keys()];
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const q = chunk.map(encodeURIComponent).join(',');
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Api-Version': '2.0' };
    let res = await fetch(`https://api.upstox.com/v2/market-quote/ohlc?instrument_key=${q}&interval=1d`, { headers });
    if (res.status === 404) {
      res = await fetch(`https://api.upstox.com/v3/market-quote/ohlc?instrument_key=${q}&interval=1d`, {
        headers: { ...headers, 'Api-Version': '3.0' },
      });
    }
    if (res.status === 401) throw authError();
    if (!res.ok) continue;
    const body = await res.json().catch(() => ({}));
    const ts = new Date().toISOString();
    for (const [k, item] of Object.entries(body.data || {})) {
      const key = item.instrument_token || item.instrument_key || k;
      remember(key, Number(item.last_price), Number(item.ohlc?.close), ts);
    }
  }
  schedulePublish();
}

function authError() {
  const err = new Error('Upstox token expired. Log in again.');
  err.code = 'AUTH';
  return err;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function stream(token) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      state.connected = false;
      if (ws && ws._upstoxFinish === finish) ws = null;
      if (err) reject(err);
      else resolve();
    };

    (async () => {
      const auth = await fetch('https://api.upstox.com/v3/feed/market-data-feed/authorize', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const body = await auth.json().catch(() => ({}));
      if (auth.status === 401) throw authError();
      const url = body?.data?.authorized_redirect_uri;
      if (!auth.ok || !url) {
        const detail = body?.errors?.[0]?.message || body?.message || `HTTP ${auth.status}`;
        throw new Error(`Upstox feed authorize failed: ${detail}`);
      }
      if (typeof WebSocket !== 'function') throw new Error('Need Node 22 or newer for the Upstox websocket.');

      const socket = new WebSocket(url);
      socket._upstoxFinish = finish;
      ws = socket;
      socket.binaryType = 'arraybuffer';
      let opened = false;

      socket.addEventListener('open', () => {
        opened = true;
        state.connected = true;
        state.message = '';
        publish();
        const keys = [...keyToRow.keys()];
        for (let i = 0; i < keys.length; i += 100) {
          const payload = JSON.stringify({
            guid: crypto.randomUUID(),
            method: 'sub',
            data: { mode: 'ltpc', instrumentKeys: keys.slice(i, i + 100) },
          });
          socket.send(new TextEncoder().encode(payload));
        }
        console.log(`[upstox] websocket subscribed ${keys.length} instruments`);
      });

      socket.addEventListener('message', (ev) => {
        const buf = toBuffer(ev.data);
        if (!buf?.length || buf[0] === 0x7b) return;
        try {
          const decoded = decodeFeed(buf);
          const ts = stamp(decoded.currentTs);
          let changed = false;
          for (const [key, feed] of Object.entries(decoded.feeds || {})) {
            if (remember(key, Number(feed?.ltpc?.ltp), Number(feed?.ltpc?.cp), ts)) changed = true;
          }
          if (changed) schedulePublish();
        } catch {
          /* ignore a bad frame */
        }
      });

      socket.addEventListener('error', () => {
        if (!opened) finish(new Error('Upstox websocket failed to connect.'));
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      });
      socket.addEventListener('close', () => finish());
    })().catch((err) => finish(err));
  });
}

async function runFeed() {
  let failures = 0;
  while (!stopped) {
    const token = readToken();
    if (!token) {
      state.authed = false;
      state.connected = false;
      state.message = state.configured
        ? 'Upstox login is required before live prices can start.'
        : 'Add UPSTOX_API_KEY and UPSTOX_API_SECRET in .env, then restart npm run dev.';
      if (!state.idleSent) {
        publish();
        state.idleSent = true;
      }
      await sleep(2000);
      continue;
    }
    state.authed = true;
    state.idleSent = false;
    state.message = 'Connecting to Upstox…';
    publish();
    try {
      await ensureMap();
      await snapshot(token);
      const openedAt = Date.now();
      await stream(token);
      // a socket that closes right away must not trigger a tight reconnect loop
      failures = Date.now() - openedAt > 30000 ? 0 : failures + 1;
      if (!stopped) await sleep(Math.min(60000, 2000 * 2 ** Math.min(failures, 5)));
    } catch (err) {
      failures += 1;
      state.connected = false;
      state.message = err.message || String(err);
      if (err.code === 'AUTH') {
        dropToken();
        state.authed = false;
      }
      publish();
      console.log(`[upstox] ${state.message}`);
      await sleep(Math.min(60000, 4000 * 2 ** Math.min(failures, 4)));
    }
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><title>Upstox</title><p>${body}</p>`);
}

async function handle(url, req, res) {
  if (url.pathname === '/api/upstox/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/api/upstox/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ...publicState(), quotes: undefined, indices: undefined, quoteCount: Object.keys(state.quotes).length }));
    return;
  }

  if (url.pathname === '/api/upstox/login') {
    if (!apiKey || !apiSecret) {
      html(res, 400, 'Put UPSTOX_API_KEY and UPSTOX_API_SECRET in the .env file, then restart npm run dev.');
      return;
    }
    pendingState = crypto.randomUUID();
    const login = new URL('https://api.upstox.com/v2/login/authorization/dialog');
    login.searchParams.set('response_type', 'code');
    login.searchParams.set('client_id', apiKey);
    login.searchParams.set('redirect_uri', redirectUri);
    login.searchParams.set('state', pendingState);
    res.writeHead(302, { Location: login.toString() });
    res.end();
    return;
  }

  if (url.pathname === '/api/upstox/callback') {
    const code = url.searchParams.get('code') || '';
    const returned = url.searchParams.get('state') || '';
    if (!code || !pendingState || returned !== pendingState) {
      html(res, 400, 'Upstox login was rejected. Go back and try the login link again.');
      return;
    }
    pendingState = '';
    const body = new URLSearchParams({
      code,
      client_id: apiKey,
      client_secret: apiSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    const tokenRes = await fetch('https://api.upstox.com/v2/login/authorization/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const json = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !json.access_token) {
      const detail = json?.errors?.[0]?.message || `HTTP ${tokenRes.status}`;
      html(res, 400, `Upstox did not return a token (${esc(detail)}). Check the redirect URL on your Upstox app.`);
      return;
    }
    writeToken(json.access_token);
    state.authed = true;
    state.message = 'Connecting to Upstox…';
    publish();
    try {
      ws?.close();
    } catch {
      /* the feed loop reconnects */
    }
    html(res, 200, 'Upstox login succeeded. <a href="/#/dashboard">Back to the dashboard</a>');
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
}

export function upstoxPlugin() {
  return {
    name: 'upstox-live',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      root = server.config.root;
      apiKey = (env.UPSTOX_API_KEY || '').trim();
      apiSecret = (env.UPSTOX_API_SECRET || '').trim();
      redirectUri = (env.UPSTOX_REDIRECT_URI || redirectUri).trim();
      state.configured = Boolean(apiKey && apiSecret);
      if (!started) {
        started = true;
        stopped = false;
        runFeed();
      }
      // Vite restarts the server when the config changes. Stop the old feed so loops do not pile up.
      server.httpServer?.once('close', () => {
        stopped = true;
        started = false;
        try {
          ws?.close();
        } catch {
          /* already closed */
        }
      });
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address();
        const port = addr && typeof addr === 'object' ? addr.port : 5173;
        console.log(`[upstox] open http://127.0.0.1:${port}  redirect must be ${redirectUri}`);
      });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        if (!url.pathname.startsWith('/api/upstox')) return next();
        try {
          await handle(url, req, res);
        } catch (err) {
          if (!res.headersSent) {
            html(res, 500, esc(err.message || 'Upstox error'));
          }
        }
      });
    },
  };
}
