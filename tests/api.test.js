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
const { default: candlesApi, sessionCandles } = await import('../api/_candles.js');

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
const { default: chainApi } = await import('../api/_chain.js');

const fakeChain = (spot, strikes) =>
  strikes.map((k) => ({
    strike_price: k,
    underlying_spot_price: spot,
    call_options: { market_data: { oi: k > spot ? 5000 + k : 1000, prev_oi: k > spot ? 4000 + k : 1000, ltp: Math.max(1, spot - k + 20), volume: 10 }, option_greeks: { iv: 20, delta: 0.5, theta: -2.1, gamma: 0.002, vega: 1.3 } },
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
  assert.equal(s.iv, 22); // median of 20 / 22 around ATM
  const odd = oiLib.chainRows(fakeChain(102, [90, 95, 100, 105, 110]).map((r) => (r.strike_price === 100 ? { ...r, call_options: { ...r.call_options, option_greeks: { iv: 151.4 } } } : r)));
  assert.ok(oiLib.summarise(odd.rows, odd.spot, odd.ivs, 'x').iv <= 22, 'absurd IV dropped');
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
  assert.equal(ch.json.rows[0].length, 17);
  assert.equal(ch.json.rows[0][10], 0.5); // CE delta
  assert.equal(ch.json.rows[0][11], -2.1); // CE theta
  // a refused token is reported, not hidden
  oiLib.resetOiCache();
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const refused = await call(oiApi, { headers: h });
  assert.equal(refused.status, 502);
  assert.equal(refused.json.error, 'UPSTOX_TOKEN_INVALID');
});

const { default: depthApi } = await import('../api/_depth.js');

test('/api/depth: 5 levels, totals and circuit limits; bad symbol refused', async () => {
  oiLib.resetOiCache();
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 'success', data: { 'NSE_EQ:RELIANCE': { last_price: 100, total_buy_quantity: 600, total_sell_quantity: 400, average_price: 99.5, upper_circuit_limit: 110, lower_circuit_limit: 90, depth: { buy: Array.from({ length: 5 }, (_, i) => ({ price: 100 - i * 0.05, quantity: 10 + i, orders: 1 })), sell: Array.from({ length: 5 }, (_, i) => ({ price: 100.05 + i * 0.05, quantity: 20, orders: 2 })) } } } }),
  });
  const { token } = auth.issueToken();
  const run = (url) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    depthApi({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }, res);
  });
  const ok = await run('/api/depth?s=RELIANCE');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.buy.length, 5);
  assert.deepEqual(ok.json.buy[0], [100, 10, 1]);
  assert.equal(ok.json.totalBuy, 600);
  assert.equal(ok.json.upperCircuit, 110);
  assert.equal((await run('/api/depth?s=..%2Fx')).status, 400);
  assert.equal((await run('/api/depth?s=NOTASTOCK')).status, 404);
});

test('supertrend, bollinger, stochastic and 15-minute candles', () => {
  const up = Array.from({ length: 75 }, (_, i) => ({ t: 1794368700 + i * 300, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
  assert.equal(intradayLib.supertrend(up).dir, 1);
  const down = up.map((b, i) => ({ ...b, o: 200 - i, h: 201 - i, l: 199 - i, c: 199.5 - i }));
  assert.equal(intradayLib.supertrend(down).dir, -1);
  const bb = intradayLib.bollinger(Array.from({ length: 20 }, () => 100));
  assert.equal(bb.mid, 100);
  assert.equal(bb.pctB, null); // flat: no band width
  const so = intradayLib.stochastic(up);
  assert.ok(so.k > 80, `stoch ${so.k}`);
  const m15 = intradayLib.to15m(up.slice(0, 7), () => 'd');
  assert.equal(m15.length, 3);
  assert.equal(m15[0].h, 103);
  assert.equal(m15[0].c, 102.5);
  assert.equal(m15[0].v, 30);
  const x = intradayLib.indicatorsFrom(up);
  assert.equal(x.stDir, 1);
  assert.equal(x.trend15, 'UP');
});

test('candles: Upstox intraday rows parsed oldest first', async () => {
  const { barsFromUpstox } = await import('../api/_candles.js');
  const b = barsFromUpstox({ data: { candles: [['2026-11-12T09:20:00+05:30', 101, 103, 100, 102, 50, 0], ['2026-11-12T09:15:00+05:30', 100, 102, 99, 101, 40, 0]] } });
  assert.equal(b.length, 2);
  assert.equal(b[0].o, 100);
  assert.equal(b[0].t, Date.parse('2026-11-12T03:45:00Z') / 1000);
  assert.equal(barsFromUpstox({ data: { candles: [] } }), null);
});

const { default: telegramApi } = await import('../api/telegram.js');
const callRaw = call;
const telegramLib = await import('../api/_lib/telegram.js');

test('/api/telegram: server builds the text from known symbols, rejects free text, dedupes, rate-limits', async () => {
  const sym = stockKeys[0][0];
  const sym2 = stockKeys[1][0];
  const auth0 = { authorization: `Bearer ${auth.issueToken().token}` };
  const call = (handler, opts = {}) => callRaw(handler, { ...opts, headers: { ...auth0, ...(opts.headers || {}) } });
  assert.equal((await callRaw(telegramApi, { method: 'POST', body: { screen: 'Lens', items: [{ s: sym, k: 'new' }] } })).status, 401, 'login on: token needed');
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  telegramLib.resetTelegramState();
  assert.equal((await call(telegramApi, { method: 'POST', body: { screen: 'Lens', items: [{ s: sym, k: 'new' }] } })).json.ok, false);
  assert.equal((await call(telegramApi)).status, 405);

  process.env.TELEGRAM_BOT_TOKEN = 'bot-tok';
  process.env.TELEGRAM_CHAT_ID = '123456';
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  telegramLib.resetTelegramState();

  // free text, unknown symbol, unknown kind, no screen: all refused, Bot API never called
  assert.equal((await call(telegramApi, { method: 'POST', body: { text: 'visit evil.example' } })).status, 400);
  assert.equal((await call(telegramApi, { method: 'POST', body: { screen: 'Lens', items: [{ s: 'NOTREAL', k: 'new' }] } })).status, 400);
  assert.equal((await call(telegramApi, { method: 'POST', body: { screen: 'Lens', items: [{ s: sym, k: 'click http://x' }] } })).status, 400);
  assert.equal((await call(telegramApi, { method: 'POST', body: { screen: '<<>>', items: [{ s: sym, k: 'new' }] } })).status, 400);
  assert.equal(calls.length, 0);

  // another site's page is refused
  const foreign = await call(telegramApi, { method: 'POST', headers: { origin: 'https://evil.example', host: 'nse.example' }, body: { screen: 'Lens', items: [{ s: sym, k: 'new' }] } });
  assert.equal(foreign.status, 403);

  const r = await call(telegramApi, { method: 'POST', headers: { origin: 'https://nse.example', host: 'nse.example' }, body: { screen: 'Pullback Stocks (Trend Continuation)', items: [{ s: sym, k: 'new' }, { s: sym2, k: 'buy', p: 101.256 }] }, ip: '7.7.7.1' });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.sent, 2);
  assert.match(calls[0].url, /^https:\/\/api\.telegram\.org\/botbot-tok\/sendMessage$/);
  assert.equal(calls[0].body.chat_id, '123456');
  const lines = calls[0].body.text.split('\n');
  assert.equal(lines[0], '📡 Pullback Stocks (Trend Continuation)');
  assert.equal(lines[1], `• ${sym}`);
  assert.equal(lines[2], `• ${sym2}: intraday BUY ₹101.26`);
  assert.match(lines[3], /^🕒 \d\d:\d\d IST$/);

  // same screen + symbol + kind again the same day (second tab, second viewer, flapping): not resent
  const again = await call(telegramApi, { method: 'POST', body: { screen: 'Pullback Stocks (Trend Continuation)', items: [{ s: sym, k: 'new' }] }, ip: '7.7.7.2' });
  assert.equal(again.json.sent, 0);
  assert.equal(calls.length, 1);

  // only Pullback alerts reach the client chat
  const other = await call(telegramApi, { method: 'POST', body: { screen: 'Momentum + Breakout', items: [{ s: sym2, k: 'new' }] }, ip: '7.7.7.2' });
  assert.equal(other.json.ok, true);
  assert.equal(other.json.sent, 0);
  assert.equal(calls.length, 1);

  // 10 calls a minute per address, then 429
  telegramLib.resetTelegramState();
  let last;
  for (let i = 0; i < 11; i += 1) last = await call(telegramApi, { method: 'POST', body: { screen: `S${i}`, items: [{ s: sym, k: 'new' }] }, ip: '7.7.7.3' });
  assert.equal(last.status, 429);
});

const { default: feedUrlApi } = await import('../api/feed-url.js');

test('/api/feed-url: one-time WebSocket URL + key map, token stays on the server', async () => {
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url: String(url), auth: opts?.headers?.Authorization });
    return { ok: true, status: 200, json: async () => ({ status: 'success', data: { authorized_redirect_uri: 'wss://feed.example/abc' } }) };
  };
  const { token } = auth.issueToken();
  const ok = await call(feedUrlApi, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.url, 'wss://feed.example/abc');
  assert.ok(Object.keys(ok.json.keys).length > 250);
  assert.deepEqual(Object.values(ok.json.keys).find((v) => v[1] === 'NIFTY 50'), ['i', 'NIFTY 50']);
  assert.match(seen[0].url, /feed\/market-data-feed\/authorize$/);
  assert.ok(!JSON.stringify(ok.json).includes(process.env.UPSTOX_ANALYTICS_TOKEN), 'token never sent to the browser');
  assert.equal((await call(feedUrlApi)).status, 401);
});

// ---------- server-side Lens alerts: /api/watch + /api/scan with an in-memory fake of Upstash ----------
const scanLib = await import('../api/_lib/scan.js');
const { default: lensApi } = await import('../api/lens.js');


function fakeUpstash() {
  const hashes = new Map();
  const sets = new Map();
  const strings = new Map();
  const run = ([cmd, key, ...args]) => {
    switch (cmd) {
      case 'HGETALL': return [...(hashes.get(key) || new Map())].flat();
      case 'HSET': { const h = hashes.get(key) || new Map(); for (let i = 0; i < args.length; i += 2) h.set(args[i], args[i + 1]); hashes.set(key, h); return args.length / 2; }
      case 'HDEL': { const h = hashes.get(key); return h && h.delete(args[0]) ? 1 : 0; }
      case 'DEL': return [hashes.delete(key), sets.delete(key), strings.delete(key)].some(Boolean) ? 1 : 0;
      case 'SADD': { const s = sets.get(key) || new Set(); const had = s.has(args[0]); s.add(args[0]); sets.set(key, s); return had ? 0 : 1; }
      case 'EXPIRE': return 1;
      case 'HINCRBY': { const h = hashes.get(key) || new Map(); const v = Number(h.get(args[0]) || 0) + Number(args[1]); h.set(args[0], String(v)); hashes.set(key, h); return v; }
      case 'GET': return strings.get(key) ?? null;
      case 'SET': if (args.includes('NX') && strings.has(key)) return null; strings.set(key, args[0]); return 'OK';
      default: throw new Error(`fake upstash: ${cmd}`);
    }
  };
  return { hashes, sets, strings, handle: (url, body) => (url.endsWith('/pipeline') ? body.map((c) => ({ result: run(c) })) : { result: run(body) }) };
}

test('watch + scan: baseline, new match alert, no repeat, edited screen re-baselines', async () => {
  const sym = stockKeys[0][0];
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-tok';
  process.env.CRON_SECRET = 'cron-secret-123';
  process.env.TELEGRAM_BOT_TOKEN = 'bot-tok';
  process.env.TELEGRAM_CHAT_ID = '123456';
  delete process.env.UPSTOX_ANALYTICS_TOKEN;
  telegramLib.resetTelegramState();
  intradayLib.resetIntradayCache();
  yahoo.resetYahooCache();
  sources.resetSourceState();

  const up = fakeUpstash();
  let ltp = 200;
  const telegrams = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://fake.upstash.io')) return { ok: true, status: 200, json: async () => up.handle(u, JSON.parse(opts.body)) };
    if (u.includes('api.telegram.org')) { telegrams.push(JSON.parse(opts.body).text); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    if (u === 'https://nse.example/data/latest.json') return { ok: true, status: 200, json: async () => ({ stocks: [{ s: sym, sec: 'Test', ltp, prevClose: 190 }], indices: [] }) };
    if (u === 'https://nse.example/config.json') return { ok: true, status: 200, json: async () => ({ screener: {} }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const auth0 = { authorization: `Bearer ${auth.issueToken().token}` };
  const run = (handler, { method = 'GET', url = '/', headers = {}, body } = {}) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    Promise.resolve(handler({ method, url, headers: { host: 'nse.example', 'x-forwarded-for': '8.8.8.8', ...headers }, body }, res));
  });
  const scan = () => run(lensApi, { url: '/api/lens?scan=1&force=1', headers: { authorization: 'Bearer cron-secret-123' } });

  assert.equal((await run(lensApi, { url: '/api/lens?scan=1&force=1' })).status, 401, 'scanner needs the cron secret');
  const bad = await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'add', name: 'Pullback Cheap', conditions: [{ field: 'nope', op: '<', value: '1' }] } });
  assert.equal(bad.status, 400);
  const add = await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'add', name: 'Pullback Cheap', conditions: [{ field: 'ltp', op: '<', value: '150' }] } });
  assert.equal(add.status, 200);
  assert.equal(add.json.screens[0].name, 'Pullback Cheap');

  await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'add', name: 'Other', conditions: [{ field: 'ltp', op: '<', value: '150' }] } });
  await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'add', name: 'Renamed', conditions: [{ field: 'vs200', op: '>', value: '0' }, { field: 'vsVwap', op: '>', value: '0' }, { field: 'volLakh', op: '>', value: '15' }] } });

  const s1 = await scan();
  assert.equal(s1.status, 200);
  assert.equal(s1.json.alerts, 0, 'first scan only sets the baseline');
  ltp = 100;
  const s2 = await scan();
  assert.equal(s2.json.sent, 1, 'Other matches too but is not a Pullback screen: not sent');
  assert.deepEqual(telegrams.at(-1).split('\n').slice(0, 3), ['📡 Pullback Cheap', 'LTP < 150', `• ${sym} ₹100.00`]);
  assert.equal(up.hashes.get(`alert:count:${telegramLib.istDay()}`)?.get('Pullback Cheap'), '1', 'counted for the day summary');
  const s3 = await scan();
  assert.equal(s3.json.sent, 0, 'still matching: no repeat');

  // leaves and comes back the same day: the shared Redis dedupe holds it back
  ltp = 200; await scan(); ltp = 100;
  assert.equal((await scan()).json.sent, 0);

  // editing the watched screen re-baselines instead of alerting
  await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'add', name: 'Pullback Cheap', conditions: [{ field: 'ltp', op: '<', value: '120' }] } });
  assert.equal((await scan()).json.alerts, 0);

  const list = await run(lensApi, { headers: auth0 });
  assert.equal(list.json.configured, true);
  assert.ok(list.json.lastScan?.at);
  await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'remove', name: 'Other' } });
  await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'remove', name: 'Renamed' } });
  const rm = await run(lensApi, { method: 'POST', headers: auth0, body: { action: 'remove', name: 'Pullback Cheap' } });
  assert.equal(rm.json.screens.length, 0);
  assert.equal(telegrams.length, 1);

  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

test('scan helpers: screen validation and market window', () => {
  assert.equal(scanLib.parseScreen({ name: 'X', conditions: [] }).error, 'BAD_CONDITION');
  assert.equal(scanLib.parseScreen({ name: '', conditions: [{ field: 'ltp', op: '<', value: '1' }] }).error, 'BAD_NAME');
  assert.deepEqual(scanLib.parseScreen({ name: 'X', conditions: [{ field: 'ltp', op: '<', value: '1' }, { field: 'rsi', op: '>', value: '' }] }).conditions, [{ field: 'ltp', op: '<', value: '1' }]);
  assert.equal(scanLib.marketWindow(Date.parse('2026-11-18T05:00:00Z')), true); // Wed 10:30 IST
  assert.equal(scanLib.marketWindow(Date.parse('2026-11-18T12:00:00Z')), false); // Wed 17:30 IST
  assert.equal(scanLib.marketWindow(Date.parse('2026-11-21T05:00:00Z')), false); // Sat
});

test('Vercel Hobby limit: at most 12 serverless functions in api/', async () => {
  const { readdirSync } = await import('node:fs');
  const fns = readdirSync(new URL('../api/', import.meta.url)).filter((f) => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12, `${fns.length} functions: ${fns.join(', ')} -- a 13th makes the whole deployment fail`);
});

test('/api/stock routes candles, chain and depth by kind; unknown kind refused', async () => {
  const { default: stockApi } = await import('../api/stock.js');
  const { token } = auth.issueToken();
  const run = (url) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, json: JSON.parse(t) }); } };
    stockApi({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }, res);
  });
  assert.equal((await run('/api/stock?kind=nope&s=RELIANCE')).json.error, 'BAD_KIND');
  assert.equal((await run('/api/stock?s=RELIANCE')).status, 400);
  assert.equal((await run('/api/stock?kind=depth&s=..%2Fx')).status, 400, 'reaches the depth handler');
  assert.equal((await run('/api/stock?kind=chain&s=NOTREAL')).status, 400, 'reaches the chain handler');
  assert.equal((await run('/api/stock?kind=candles&s=..%2Fsecret')).status, 400, 'reaches the candles handler');
});

test('/api/oi: a fresh snapshot in Redis is served without calling Upstox; a busy lock serves the stale one', async () => {
  const up = fakeUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-tok';
  const upstoxCalls = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://fake.upstash.io')) return { ok: true, status: 200, json: async () => up.handle(u, JSON.parse(opts.body)) };
    upstoxCalls.push(u);
    return { ok: false, status: 500, json: async () => ({}) };
  };
  try {
    oiLib.resetOiCache();
    up.strings.set('oi:snap', JSON.stringify({ at: Date.now(), payload: { count: 7, stocks: {}, indices: {} } }));
    assert.equal((await oiLib.getOi('tok')).count, 7);
    assert.equal(upstoxCalls.length, 0, 'shared snapshot, no Upstox burst');

    // snapshot is old and another instance holds the lock: stale snapshot, still no burst
    oiLib.resetOiCache();
    up.strings.set('oi:snap', JSON.stringify({ at: Date.now() - 10 * 60_000, payload: { count: 5, stocks: {}, indices: {} } }));
    up.strings.set('oi:lock', '1');
    const r = await oiLib.getOi('tok');
    assert.equal(r.count, 5);
    assert.equal(r.stale, true);
    assert.equal(upstoxCalls.length, 0);
  } finally {
    oiLib.resetOiCache();
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

test('scan helpers: Upstox vs Yahoo cross-check, session detection, token expiry', async () => {
  const now = Date.parse('2026-11-18T05:00:00Z'); // Wed 10:30 IST
  const fresh = new Date(now - 60_000).toISOString();
  const gaps = scanLib.divergent({ A: { ltp: 100 }, B: { ltp: 100 }, C: { ltp: 100 } }, { A: { ltp: 100.4, t: fresh }, B: { ltp: 103, t: fresh }, C: { ltp: 110, t: new Date(now - 10 * 60_000).toISOString() } }, now);
  assert.deepEqual(gaps.map((g) => g.s), ['B'], 'small gap passes, big gap held, stale Yahoo ignored');
  assert.equal(scanLib.sessionToday({ stocks: { A: { iAt: '2026-11-18T04:55:00Z' } } }, now), true);
  assert.equal(scanLib.sessionToday({ stocks: { A: { iAt: '2026-11-17T09:55:00Z' } } }, now), false, 'only yesterday bars: holiday');
  assert.equal(scanLib.sessionToday(null, now), null);
  const { tokenExpiry } = await import('../api/_lib/daily.js');
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: 1800000000 })).toString('base64url')}.y`;
  assert.equal(tokenExpiry(jwt), 1800000000 * 1000);
  assert.equal(tokenExpiry('not-a-jwt'), null);
});

test('daily messages: open, close summary, health report', async () => {
  const daily = await import('../api/_lib/daily.js');
  const up = fakeUpstash();
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-tok';
  process.env.TELEGRAM_BOT_TOKEN = 'bot-tok';
  process.env.TELEGRAM_CHAT_ID = '111';
  process.env.TELEGRAM_OWNER_CHAT_ID = '999';
  delete process.env.UPSTOX_ANALYTICS_TOKEN;
  intradayLib.resetIntradayCache();
  yahoo.resetYahooCache();
  const sent = [];
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://fake.upstash.io')) return { ok: true, status: 200, json: async () => up.handle(u, JSON.parse(opts.body)) };
    if (u.includes('api.telegram.org')) { const b = JSON.parse(opts.body); sent.push([b.chat_id, b.text]); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    if (u === 'https://nse.example/data/latest.json') return { ok: true, status: 200, json: async () => ({ meta: { generatedAtIST: '18-Nov-2026 07:00 PM IST', lastTradingDate: '2026-11-18', health: [{ name: 'Symbols loaded', ok: true, detail: '259 of 259' }, { name: 'All stocks on the latest session', ok: false, detail: '3 of 259 behind' }], recon: { date: '2026-11-18', status: 'mismatch', checked: 256, mismatched: 1, items: [{ s: 'ABC', field: 'close', ours: 10, nse: 11, diffPct: -9.09 }] }, filledFromNse: ['X', 'Y'] }, stocks: [] }) };
    if (u === 'https://nse.example/data/fundamentals.json') return { ok: true, status: 200, json: async () => ({ asOf: new Date().toISOString(), ok: 259 }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    up.hashes.set('lens:watch', new Map([['Pullback', JSON.stringify({ name: 'Pullback', conditions: [{ field: 'ltp', op: '>', value: '1' }] })]]));
    const n0 = sent.length;
    assert.equal((await daily.dailyOpen()).skipped, 'DAILY_MESSAGES off');
    assert.equal((await daily.dailyClose()).skipped, 'DAILY_MESSAGES off');
    assert.equal(sent.length, n0, 'client chat gets Pullback alerts only');

    process.env.DAILY_MESSAGES = 'on';
    const o = await daily.dailyOpen();
    assert.equal(o.ok, true);
    assert.equal(sent.at(-1)[0], '111');
    assert.match(sent.at(-1)[1], /NSE Stocks Pro is running[\s\S]*Watching 1 screen\(s\):\n• Pullback/);

    assert.match(sent.at(-1)[1], /Live prices: (not available right now|Yahoo)/);
    const c0 = await daily.dailyClose();
    assert.equal(c0.total, 0);
    assert.match(sent.at(-1)[1], /no new matches today on the 1 watched screen/);
    up.hashes.set(`alert:count:${telegramLib.istDay()}`, new Map([['Pullback', '3']]));
    await daily.dailyClose();
    assert.match(sent.at(-1)[1], /3 new match alert\(s\)\n• Pullback: 3/);

    const h = await daily.dailyHealth('https://nse.example');
    assert.equal(h.recon, 'mismatch');
    assert.equal(sent.at(-1)[0], '999', 'health goes to the owner chat');
    assert.match(sent.at(-1)[1], /❌ 1 of 256 differ\n  ABC close: ours 10 vs NSE 11/);
    assert.match(sent.at(-1)[1], /❌ All stocks on the latest session: 3 of 259 behind/);
    assert.match(sent.at(-1)[1], /Filled from NSE \(Yahoo was late\): 2/);
  } finally {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.TELEGRAM_OWNER_CHAT_ID;
    delete process.env.DAILY_MESSAGES;
  }
});

test('intraday layer: ADX, 9/21 cross, SMC zone and the 10-session 5-minute volume base', () => {
  const day = 86400;
  const bars = [];
  const t0 = Date.UTC(2026, 10, 2, 3, 45) / 1000;
  for (let d = 0; d < 12; d += 1) {
    for (let k = 0; k < 75; k += 1) {
      const p = 100 + Math.sin((d * 75 + k) / 9) * 2;
      bars.push({ t: t0 + d * day + k * 300, o: p, h: p + 0.5, l: p - 0.5, c: p + 0.1, v: 1000 });
    }
  }
  bars[bars.length - 2].v = 5000;
  const out = intradayLib.indicatorsFrom(bars, { now: (bars[bars.length - 1].t + 60) * 1000 });
  assert.ok(out.ema21i && out.ema50i && out.adxI > 0 && out.atrI > 0);
  assert.equal(out.vol5m, 5000);
  assert.equal(out.vol5mAvg, 1000);
  assert.equal(out.vol5mX, 5);
  assert.ok(['DEMAND', 'SUPPLY', 'NEUTRAL'].includes(out.smcZone));
  assert.deepEqual(intradayLib.lastCross([1, 3], [2, 2], 2), { dir: 'BULL', ago: 0 });
  assert.equal(intradayLib.lastCross([1, 1, 1], [2, 2, 2], 3), null);
  const ob = [
    ...Array.from({ length: 8 }, (_, i) => ({ o: 100, h: 101, l: 99, c: 100 + (i % 2 ? 0.2 : -0.2) })),
    { o: 100, h: 100.5, l: 98, c: 98.5 },
    { o: 98.5, h: 103, l: 98.4, c: 102.5 },
    { o: 102.5, h: 102.6, l: 99.8, c: 100.2 },
  ];
  assert.equal(intradayLib.smcZone(ob, 1.5), 'DEMAND');
});

test('Most Active: first scan of the day is the baseline, a new top-10 entry alerts, telegram screen filter', () => {
  const rows = (vals) => vals.map((v, i) => ({ s: `S${i}`, ltp: 100 + i, chg: 1, dayValueCr: v }));
  const day = '2026-11-26';
  const base = scanLib.diffActive(rows([50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3]), null, day);
  assert.equal(base.items.length, 0, 'no previous list: baseline only');
  assert.deepEqual(JSON.parse(base.next).syms, ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
  const moved = scanLib.diffActive(rows([50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 60]), base.next, day);
  assert.deepEqual(moved.items.map((i) => i.s), ['S11'], 'S11 jumps into the top 10');
  assert.equal(scanLib.diffActive(rows([1, 2]), base.next, '2026-11-27').items.length, 0, 'new day: baseline again');
  assert.equal(scanLib.diffActive([{ s: 'X', valueCr: 999 }], base.next, day).items.length, 0, 'previous-day turnover is not used');

  assert.equal(scanLib.telegramScreen({ name: 'My pullback', conditions: [] }), true);
  assert.equal(scanLib.telegramScreen({ name: 'Renamed', conditions: [{ field: 'vs200', op: '>', value: '0' }, { field: 'vsVwap', op: '>', value: '0' }, { field: 'volLakh', op: '>', value: '15' }] }), true);
  assert.equal(scanLib.telegramScreen({ name: 'Cheap', conditions: [{ field: 'ltp', op: '<', value: '1' }] }), false);
});
