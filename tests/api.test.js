import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SITE_PASSWORD = 'Vishu@4321';
process.env.SESSION_SECRET = 'test-secret-test-secret-123456';
process.env.UPSTOX_ANALYTICS_TOKEN = 'tok';

const { default: login } = await import('../api/login.js');
const { default: quotes } = await import('../api/quotes.js');
const { default: health } = await import('../api/health.js');
const upstox = await import('../api/_lib/upstox.js');
const auth = await import('../api/_lib/auth.js');
const instruments = (await import('../api/_instruments.json', { with: { type: 'json' } })).default;
const yahoo = await import('../api/_lib/yahoo.js');
const sources = await import('../api/quotes.js');

function call(handler, { method = 'GET', headers = {}, body, ip = '1.1.1.1' } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      end(text) {
        resolve({ status: this.statusCode, headers: this.headers, json: text ? JSON.parse(text) : null });
      },
    };
    Promise.resolve(handler({ method, headers: { 'x-forwarded-for': ip, ...headers }, body }, res));
  });
}

const stockKeys = Object.entries(instruments.stocks);
function fakeUpstream(calls) {
  return async (url) => {
    calls.push(String(url));
    const keys = decodeURIComponent(String(url).split('instrument_key=')[1]).split(',');
    const data = {};
    keys.forEach((k, i) => {
      data[k.replace('|', ':')] = { last_price: 100 + i, instrument_token: k, cp: 99, volume: 1000 };
    });
    return { ok: true, status: 200, json: async () => ({ status: 'success', data }) };
  };
}

test('health says live is available and leaks no secret', async () => {
  const r = await call(health);
  assert.equal(r.json.live, true);
  assert.ok(!JSON.stringify(r.json).includes('tok'));
});

test('login: wrong password is rejected, right password returns a token', async () => {
  const bad = await call(login, { method: 'POST', body: { password: 'nope' }, ip: '9.9.9.1' });
  assert.equal(bad.status, 401);
  const good = await call(login, { method: 'POST', body: { password: 'Vishu@4321' }, ip: '9.9.9.2' });
  assert.equal(good.status, 200);
  assert.ok(auth.verifyToken(good.json.token));
  assert.equal(good.headers['cache-control'], 'private, no-store');
});

test('login: 5 wrong tries lock the address', async () => {
  for (let i = 0; i < 5; i += 1) await call(login, { method: 'POST', body: { password: 'x' }, ip: '9.9.9.3' });
  const r = await call(login, { method: 'POST', body: { password: 'Vishu@4321' }, ip: '9.9.9.3' });
  assert.equal(r.status, 429);
});

test('login: GET is not allowed', async () => {
  assert.equal((await call(login)).status, 405);
});

test('tokens: tampered and expired tokens fail', () => {
  const { token } = auth.issueToken();
  assert.ok(auth.verifyToken(token));
  assert.ok(!auth.verifyToken(`${token}x`));
  assert.ok(!auth.verifyToken(`9999999999.${token.split('.')[1]}`));
  assert.ok(!auth.verifyToken(token, Date.now() + 13 * 3600 * 1000));
  assert.ok(!auth.verifyToken(''));
});

test('quotes: no token means 401 and Upstox is never called', async () => {
  const calls = [];
  global.fetch = fakeUpstream(calls);
  upstox.resetCache();
  sources.resetSourceState();
  const r = await call(quotes);
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test('quotes: maps every instrument, splits into chunks, caches for a few seconds', async () => {
  const calls = [];
  global.fetch = fakeUpstream(calls);
  upstox.resetCache();
  sources.resetSourceState();
  const { token } = auth.issueToken();
  const h = { authorization: `Bearer ${token}` };
  const r = await call(quotes, { headers: h });
  assert.equal(r.status, 200);
  assert.equal(Object.keys(r.json.quotes).length, stockKeys.length);
  assert.equal(Object.keys(r.json.indices).length, 4);
  assert.equal(r.json.quotes.RELIANCE.cp, 99);
  assert.equal(calls.length, Math.ceil((stockKeys.length + 4) / 50));
  assert.ok(calls.every((u) => u.startsWith('https://api.upstox.com/v3/market-quote/ltp?instrument_key=')));
  await call(quotes, { headers: h });
  assert.equal(calls.length, Math.ceil((stockKeys.length + 4) / 50), 'second call inside the cache window must not hit Upstox');
});

test('quotes: when Upstox and Yahoo both fail, the Upstox token problem is reported clearly', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  upstox.resetCache();
  yahoo.resetYahooCache();
  sources.resetSourceState();
  const { token } = auth.issueToken();
  const r = await call(quotes, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'NO_SOURCE');
  assert.match(r.json.message, /Analytics Token/);
});

test('quotes: if Upstox fails after a good fetch, the last prices come back marked stale', async () => {
  global.fetch = fakeUpstream([]);
  upstox.resetCache();
  await upstox.getQuotes('tok'); // good fetch fills the cache
  global.fetch = async () => {
    throw new Error('network down');
  };
  const r = await upstox.getQuotes('tok', Date.now() + 30_000); // 30 s later the cache is too old, refresh fails
  assert.equal(r.stale, true);
  assert.ok(Object.keys(r.quotes).length > 100);
  await assert.rejects(upstox.getQuotes('tok', Date.now() + 10 * 60_000), /Could not reach Upstox/); // 10 min later: too old to serve
});

test('quotes: one failed chunk still returns the rest, marked partial', async () => {
  let n = 0;
  const calls = [];
  const good = fakeUpstream(calls);
  global.fetch = async (u) => (n++ === 1 ? { ok: false, status: 500, json: async () => ({}) } : good(u));
  upstox.resetCache();
  sources.resetSourceState();
  const { token } = auth.issueToken();
  const r = await call(quotes, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  assert.equal(r.json.partial, true);
  assert.ok(Object.keys(r.json.quotes).length > 100);
});

test('normalise ignores zero and missing prices', () => {
  const [sym, key] = stockKeys[0];
  const out = upstox.normalise([{ [key]: { last_price: 0, instrument_token: key }, junk: { last_price: 5 } }], 't');
  assert.deepEqual(out.quotes, {});
  assert.ok(sym);
});

test('open mode: without SITE_PASSWORD the prices need no sign-in, and health says so', async () => {
  const keep = process.env.SITE_PASSWORD;
  delete process.env.SITE_PASSWORD;
  try {
    global.fetch = fakeUpstream([]);
    upstox.resetCache();
    sources.resetSourceState();
    const r = await call(quotes);
    assert.equal(r.status, 200);
    assert.ok(Object.keys(r.json.quotes).length > 100);
    assert.equal((await call(health)).json.login, false);
  } finally {
    process.env.SITE_PASSWORD = keep;
  }
});

function fakeYahoo(calls) {
  return async (url) => {
    calls.push(String(url));
    const syms = decodeURIComponent(String(url).split('symbols=')[1].split('&')[0]).split(',');
    assert.ok(syms.length <= 20, 'Yahoo rejects more than 20 symbols per call');
    const body = {};
    const now = Math.floor(Date.now() / 1000);
    for (const s of syms) body[s] = { symbol: s, timestamp: [now - 300, now - 5], close: [100, 101.5], previousClose: 99, chartPreviousClose: 99 };
    return { ok: true, status: 200, json: async () => body };
  };
}

test('yahoo fallback: batches of 20, maps stocks and indices, reports lag', async () => {
  const calls = [];
  global.fetch = fakeYahoo(calls);
  yahoo.resetYahooCache();
  const p = await yahoo.getYahooQuotes();
  assert.equal(Object.keys(p.quotes).length, stockKeys.length);
  assert.equal(Object.keys(p.indices).length, 4);
  assert.equal(p.quotes.RELIANCE.ltp, 101.5);
  assert.equal(p.quotes.RELIANCE.cp, 99);
  assert.equal(calls.length, Math.ceil((stockKeys.length + 4) / 20));
  assert.ok(p.lagMin <= 1);
});

test('yahoo fallback: a null last bar falls back to the previous real price', () => {
  const now = Math.floor(Date.now() / 1000);
  const out = yahoo.normaliseYahoo([{ 'RELIANCE.NS': { timestamp: [now - 120, now - 60], close: [1300, null], previousClose: 1290 } }]);
  assert.equal(out.quotes.RELIANCE.ltp, 1300);
});

test('source order: no Upstox token means Yahoo answers and says why', async () => {
  const keep = process.env.UPSTOX_ANALYTICS_TOKEN;
  delete process.env.UPSTOX_ANALYTICS_TOKEN;
  try {
    global.fetch = fakeYahoo([]);
    yahoo.resetYahooCache();
    sources.resetSourceState();
    const { token } = auth.issueToken();
    const r = await call(sources.default, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    assert.equal(r.json.source, 'yahoo');
    assert.match(r.json.fallbackReason, /not set/);
  } finally {
    process.env.UPSTOX_ANALYTICS_TOKEN = keep;
  }
});

test('source order: a rejected Upstox token falls back to Yahoo, then Upstox is skipped for a while', async () => {
  const upstoxCalls = [];
  global.fetch = async (url, opts) => {
    if (String(url).includes('upstox.com')) {
      upstoxCalls.push(1);
      return { ok: false, status: 401, json: async () => ({}) };
    }
    return fakeYahoo([])(url, opts);
  };
  upstox.resetCache();
  yahoo.resetYahooCache();
  sources.resetSourceState();
  const { token } = auth.issueToken();
  const h = { authorization: `Bearer ${token}` };
  const a = await call(sources.default, { headers: h });
  assert.equal(a.json.source, 'yahoo');
  assert.match(a.json.fallbackReason, /Analytics Token/);
  const before = upstoxCalls.length;
  yahoo.resetYahooCache();
  await call(sources.default, { headers: h });
  assert.equal(upstoxCalls.length, before, 'Upstox must not be retried while it is blocked');
});

test('source order: when Upstox works it wins', async () => {
  global.fetch = fakeUpstream([]);
  upstox.resetCache();
  sources.resetSourceState();
  const { token } = auth.issueToken();
  const r = await call(sources.default, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.json.source, 'upstox');
});

// ---------- /api/intraday: live 5-minute EMA / RSI / MACD ----------
const intradayLib = await import('../api/_lib/intraday.js');
const { default: intradayApi } = await import('../api/intraday.js');

test('intraday layer: EMA / RSI follow pandas, VWAP / ORB / CPR from the bars', () => {
  assert.deepEqual(intradayLib.emaSeries([10, 20], 3), [10, 15]);
  assert.equal(intradayLib.rsiLast([1, 2, 3], 14), null);
  assert.equal(intradayLib.rsiLast(Array.from({ length: 30 }, (_, i) => 100 + i)), null); // no losses: undefined, not a made-up 100
  // yesterday 2026-11-10 (IST) 30 bars, today 2026-11-11 6 bars; 09:15 IST = 03:45 UTC
  const day = (iso, n, base) =>
    Array.from({ length: n }, (_, i) => ({ t: Date.parse(iso) / 1000 + i * 300, o: base + i, h: base + i + 2, l: base + i - 1, c: base + i + 1, v: 100 }));
  const bars = [...day('2026-11-10T03:45:00Z', 30, 100), ...day('2026-11-11T03:45:00Z', 6, 140)];
  const x = intradayLib.indicatorsFrom(bars);
  assert.equal(x.pdh, 131); // 100 + 29 + 2
  assert.equal(x.pdl, 99);
  assert.equal(x.pdc, 130);
  assert.equal(x.dayOpen, 140);
  assert.equal(x.orbHigh, 144); // first three bars of today: highs 142, 143, 144
  assert.equal(x.orbLow, 139);
  assert.equal(x.iBars, 6);
  const typ = [0, 1, 2, 3, 4, 5].map((i) => (140 + i + 2 + 140 + i - 1 + 140 + i + 1) / 3);
  assert.equal(x.vwap, Math.round((typ.reduce((a, b) => a + b, 0) / 6) * 100) / 100);
  const P = (131 + 99 + 130) / 3;
  assert.equal(x.cprPivot, Math.round(P * 100) / 100);
  assert.equal(x.vwapProxy, undefined);
  assert.equal(intradayLib.indicatorsFrom(bars, { index: true }).vwapProxy, true);
  assert.equal(intradayLib.indicatorsFrom(bars.slice(0, 5)), null);
});

test('intraday maps Yahoo tickers to symbols and indices, behind the same login', async () => {
  intradayLib.resetIntradayCache();
  const sym = stockKeys[0][0];
  const ts = Array.from({ length: 40 }, (_, i) => Date.parse('2026-11-11T03:45:00Z') / 1000 + i * 300);
  const closes = ts.map((_, i) => 200 + Math.sin(i) * 3);
  global.fetch = async (url) => {
    const ticker = decodeURIComponent(String(url).split('/chart/')[1].split('?')[0]);
    if (ticker !== `${sym}.NS` && ticker !== '^NSEI') return { ok: false, status: 404, json: async () => ({}) };
    const quote = { open: closes, high: closes.map((c) => c + 1), low: closes.map((c) => c - 1), close: closes, volume: closes.map(() => 10) };
    return { ok: true, status: 200, json: async () => ({ chart: { result: [{ timestamp: ts, indicators: { quote: [quote] } }] } }) };
  };
  const denied = await call(intradayApi);
  assert.equal(denied.status, 401);
  const { token } = auth.issueToken();
  const ok = await call(intradayApi, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.stocks[sym].ema9i > 0 && ok.json.stocks[sym].vwap > 0);
  assert.ok(ok.json.indices['NIFTY 50'].rsiI > 0);
  assert.equal(ok.json.indices['NIFTY 50'].vwapProxy, true);
  assert.equal(ok.json.count, 1);
  assert.equal(ok.json.partial, true);
  assert.equal(ok.headers['cache-control'], 'private, no-store');
});

// ---------- /api/candles ----------
const { default: candlesApi, sessionCandles } = await import('../api/candles.js');

test('candles: today only, running VWAP, unknown symbols refused', async () => {
  const day = (iso, n, base) => Array.from({ length: n }, (_, i) => ({ t: Date.parse(iso) / 1000 + i * 300, o: base, h: base + 2, l: base - 1, c: base + 1, v: i + 1 }));
  const s = sessionCandles([...day('2026-11-10T03:45:00Z', 5, 100), ...day('2026-11-11T03:45:00Z', 3, 200)]);
  assert.equal(s.day, '2026-11-11');
  assert.equal(s.bars.length, 3);
  assert.equal(s.bars[2][6], Math.round(((200 + 2 + 200 - 1 + 200 + 1) / 3) * 100) / 100);
  assert.equal(s.vwapProxy, false);
  assert.equal(sessionCandles([...day('2026-11-11T03:45:00Z', 2, 50)], true).vwapProxy, true);
  const { token } = auth.issueToken();
  const h = { authorization: `Bearer ${token}` };
  const bad = await new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    candlesApi({ method: 'GET', url: '/api/candles?s=..%2Fsecret', headers: h }, res);
  });
  assert.equal(bad.status, 400);
});

// ---------- /api/cron-refresh (Vercel Cron -> GitHub workflow_dispatch) ----------
const { default: cronRefresh } = await import('../api/cron-refresh.js');

test('cron refresh: only with the cron secret, dispatches the workflow once', async () => {
  process.env.CRON_SECRET = 'cron-secret-123';
  delete process.env.GH_DISPATCH_TOKEN;
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { status: 204 };
  };
  assert.equal((await call(cronRefresh)).status, 401);
  assert.equal((await call(cronRefresh, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call(cronRefresh, { headers: { authorization: 'Bearer cron-secret-123' } })).status, 503);
  process.env.GH_DISPATCH_TOKEN = 'gh-token';
  const ok = await call(cronRefresh, { headers: { authorization: 'Bearer cron-secret-123' } });
  assert.equal(ok.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /actions\/workflows\/update-data-and-deploy\.yml\/dispatches$/);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(JSON.parse(calls[0].opts.body).ref, 'main');
  global.fetch = async () => ({ status: 403 });
  assert.equal((await call(cronRefresh, { headers: { authorization: 'Bearer cron-secret-123' } })).status, 502);
});

// ---------- /api/oi and /api/chain (Upstox option chain + futures) ----------
const oiLib = await import('../api/_lib/upstoxOi.js');
const { default: oiApi } = await import('../api/oi.js');
const { default: chainApi } = await import('../api/chain.js');

const fakeChain = (spot, strikes) =>
  strikes.map((k) => ({
    strike_price: k,
    underlying_spot_price: spot,
    call_options: { market_data: { oi: k > spot ? 5000 + k : 1000, prev_oi: k > spot ? 4000 + k : 1000, ltp: Math.max(1, spot - k + 20), volume: 10 }, option_greeks: { iv: 20 } },
    put_options: { market_data: { oi: k < spot ? 6000 + k : 1000, prev_oi: k < spot ? 5000 : 1000, ltp: Math.max(1, k - spot + 20), volume: 10 }, option_greeks: { iv: 22 } },
  }));

test('option chain summary: PCR, OI walls, writing, max pain, ATM IV', () => {
  const c = oiLib.chainRows(fakeChain(102, [90, 95, 100, 105, 110]));
  const s = oiLib.summarise(c.rows, c.spot, c.ivs, '2026-11-23');
  assert.equal(s.atmLive, 100);
  assert.equal(s.step, 5);
  assert.equal(s.callOiRes, 110);
  assert.equal(s.putOiSup, 100);
  assert.equal(s.callWriting, 105); // 1000 + 105 rise vs 1000 + 110: same, first max wins
  assert.equal(s.iv, 21);
  assert.equal(s.pcr, Math.round((s.peOi / s.ceOi) * 100) / 100);
  assert.ok([90, 95, 100, 105, 110].includes(s.maxPain));
  assert.equal(oiLib.summarise([], 100, new Map(), 'x'), null);
  assert.equal(oiLib.pickExpiry(['2026-11-10', '2026-11-17', '2026-11-23'], '2026-11-12'), '2026-11-17');
  assert.equal(oiLib.pickExpiry(['2026-11-12'], '2026-11-12'), '2026-11-12');
  assert.deepEqual(oiLib.nearFuture([['2026-11-23', 'K1'], ['2026-12-29', 'K2']], '2026-11-24'), ['2026-12-29', 'K2']);
});

test('/api/oi: option chains + futures quotes, login and token errors', async () => {
  oiLib.resetOiCache();
  const calls = [];
  global.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/option/chain')) return { ok: true, status: 200, json: async () => ({ status: 'success', data: fakeChain(102, [90, 95, 100, 105, 110]) }) };
    if (u.includes('/market-quote/quotes')) {
      const keys = decodeURIComponent(u.split('instrument_key=')[1]).split(',');
      const data = Object.fromEntries(keys.map((k, i) => [`NSE_FO:X${i}`, { instrument_token: k, last_price: 101, oi: 1100, volume: 50, net_change: 1, ohlc: { close: 101 } }]));
      return { ok: true, status: 200, json: async () => ({ status: 'success', data }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  assert.equal((await call(oiApi)).status, 401);
  const { token } = auth.issueToken();
  const h = { authorization: `Bearer ${token}` };
  const ok = await call(oiApi, { headers: h });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.count > 150, `count ${ok.json.count}`);
  assert.equal(ok.json.indices['NIFTY 50'].pcr > 0, true);
  assert.equal(ok.json.stocks.RELIANCE.futLive, 101);
  assert.equal(ok.json.stocks.RELIANCE.futOiLive, 1100);
  assert.equal(ok.json.stocks.RELIANCE.futCp, 100);
  assert.match(calls.find((c) => c.includes('/option/chain')), /expiry_date=\d{4}-\d{2}-\d{2}/);
  // chain endpoint
  const bad = await new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    chainApi({ method: 'GET', url: '/api/chain?s=NOTREAL', headers: h }, res);
  });
  assert.equal(bad.status, 400);
  const ch = await new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    chainApi({ method: 'GET', url: '/api/chain?s=reliance', headers: h }, res);
  });
  assert.equal(ch.status, 200);
  assert.equal(ch.json.atm, 100);
  assert.equal(ch.json.rows[0].length, 9);
  // a refused token is reported, not hidden
  oiLib.resetOiCache();
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const refused = await call(oiApi, { headers: h });
  assert.equal(refused.status, 502);
  assert.equal(refused.json.error, 'UPSTOX_TOKEN_INVALID');
});
