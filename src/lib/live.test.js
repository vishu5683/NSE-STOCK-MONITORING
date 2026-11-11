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
