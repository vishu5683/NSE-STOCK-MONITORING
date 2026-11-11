import assert from 'node:assert/strict';
import test from 'node:test';
import { applyLive } from './live.js';

const row = { s: 'RELIANCE', ltp: 100, chg: 1, prevClose: 99, hi52: 120, lo52: 80, distHi: -16.67, distLo: 25, rsi: 55 };

test('live quote replaces price and day change from previous close', () => {
  const next = applyLive(row, { ltp: 110, cp: 100, ts: 't' });
  assert.equal(next.ltp, 110);
  assert.equal(next.chg, 10);
  assert.equal(next.prevClose, 100);
  assert.equal(next.live, true);
  assert.equal(next.rsi, 55);
  assert.equal(row.ltp, 100);
});

test('missing quote leaves the daily row untouched', () => {
  assert.equal(applyLive(row, null), row);
  assert.equal(applyLive(row, { ltp: null }), row);
});

test('without a previous close the change is blank, not the old percent', () => {
  const next = applyLive({ ...row, prevClose: null }, { ltp: 110 });
  assert.equal(next.ltp, 110);
  assert.equal(next.chg, null);
});

test('a new high moves the 52-week high to the live price', () => {
  const next = applyLive(row, { ltp: 130, cp: 100 });
  assert.equal(next.hi52, 130);
  assert.equal(next.distHi, 0);
});

import { applyIntraday } from './live.js';

test('live indicators overlay EMA / RSI / MACD but keep VWAP and CPR from the file', () => {
  const data = { stocks: [{ s: 'A', vwap: 100, cprBc: 90, ema9i: 1, rsiI: 10, iAsOf: '2026-11-11 13:00' }, { s: 'B', ema9i: 5 }], indices: [{ name: 'NIFTY 50', ema9i: 1 }] };
  const out = applyIntraday(data, { stocks: { A: { ema9i: 101, ema15i: 99, rsiI: 61.2, macdI: 0.5, macdIsig: 0.2, iAt: '2026-11-11T09:02:50.000Z' } }, indices: { 'NIFTY 50': { ema9i: 25000 } } });
  assert.equal(out.stocks[0].ema9i, 101);
  assert.equal(out.stocks[0].vwap, 100);
  assert.equal(out.stocks[0].cprBc, 90);
  assert.equal(out.stocks[0].iAsOf, '2026-11-11 14:32');
  assert.equal(out.stocks[0].iLive, true);
  assert.equal(out.stocks[1].ema9i, 5);
  assert.equal(out.stocks[1].iLive, undefined);
  assert.equal(out.indices[0].ema9i, 25000);
  assert.equal(applyIntraday(data, null), data);
});
