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
  const r = await call(quotes);
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test('quotes: maps every instrument, splits into chunks, caches for a few seconds', async () => {
  const calls = [];
  global.fetch = fakeUpstream(calls);
  upstox.resetCache();
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

test('quotes: a rejected token is reported clearly', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  upstox.resetCache();
  const { token } = auth.issueToken();
  const r = await call(quotes, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'UPSTOX_TOKEN_INVALID');
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
    const r = await call(quotes);
    assert.equal(r.status, 200);
    assert.ok(Object.keys(r.json.quotes).length > 100);
    assert.equal((await call(health)).json.login, false);
  } finally {
    process.env.SITE_PASSWORD = keep;
  }
});
