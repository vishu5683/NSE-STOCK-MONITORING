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

test('live intraday layer overrides the file, keeps what it does not send', () => {
  const data = { stocks: [{ s: 'A', vwap: 100, cprBc: 90, rsi: 55, ema9i: 1, rsiI: 10, iAsOf: '2026-11-11 13:00' }, { s: 'B', ema9i: 5 }], indices: [{ name: 'NIFTY 50', ema9i: 1 }] };
  const out = applyIntraday(data, { stocks: { A: { ema9i: 101, ema15i: 99, rsiI: 61.2, macdI: 0.5, macdIsig: 0.2, vwap: 102.5, orbHigh: 104, iAt: '2026-11-11T09:02:50.000Z' } }, indices: { 'NIFTY 50': { ema9i: 25000, vwap: 25100, vwapProxy: true } } });
  assert.equal(out.stocks[0].ema9i, 101);
  assert.equal(out.stocks[0].vwap, 102.5);
  assert.equal(out.stocks[0].orbHigh, 104);
  assert.equal(out.stocks[0].cprBc, 90);
  assert.equal(out.stocks[0].rsi, 55);
  assert.equal(out.indices[0].vwapProxy, true);
  assert.equal(out.stocks[0].iAsOf, '2026-11-11 14:32');
  assert.equal(out.stocks[0].iLive, true);
  assert.equal(out.stocks[1].ema9i, 5);
  assert.equal(out.stocks[1].iLive, undefined);
  assert.equal(out.indices[0].ema9i, 25000);
  assert.equal(applyIntraday(data, null), data);
});

test('previous-session levels: official file values win on the same day, live values fill an old file', () => {
  const live = { stocks: { A: { pdh: 388, cprBc: 384.55, vwap: 398, iAt: '2026-11-11T09:00:00.000Z' } } };
  const today = applyIntraday({ stocks: [{ s: 'A', pdh: 387.5, pdc: 385.75, cprBc: 384.8, iAsOf: '2026-11-11 14:20' }], indices: [] }, live);
  assert.equal(today.stocks[0].pdh, 387.5);
  assert.equal(today.stocks[0].cprBc, 384.8);
  assert.equal(today.stocks[0].vwap, 398);
  const old = applyIntraday({ stocks: [{ s: 'A', pdh: 300, pdc: 299, cprBc: 290, iAsOf: '2026-11-10 15:25' }], indices: [] }, live);
  assert.equal(old.stocks[0].pdh, 388);
  assert.equal(old.stocks[0].cprBc, 384.55);
});

import { applyOi } from './live.js';

test('live OI overlays option and futures fields while the NSE end-of-day file is older', () => {
  const data = { stocks: [{ s: 'A', ltp: 100, pcr: 0.7, futOi: 1000, futPrice: 99, futBuildup: 'SHORT BUILDUP', maxPain: 90 }, { s: 'B', pcr: 1.1 }], indices: [{ name: 'NIFTY 50', pcr: 1 }] };
  const oi = { day: '2026-11-12', asOf: '2026-11-12T05:00:00Z', stocks: { A: { pcr: 1.3, maxPain: 95, callOiRes: 110, futLive: 101, futOiLive: 1100, futCp: 100 } }, indices: { 'NIFTY 50': { pcr: 1.2 } } };
  const out = applyOi(data, oi, '2026-11-11');
  const a = out.stocks[0];
  assert.equal(a.pcr, 1.3);
  assert.equal(a.maxPain, 95);
  assert.equal(a.futPrice, 101);
  assert.equal(a.futOi, 1100);
  assert.equal(a.futOiChg, 100);
  assert.equal(a.futOiChgPct, 10);
  assert.equal(a.futBasis, 1);
  assert.equal(a.futBuildup, 'LONG BUILDUP');
  assert.equal(a.oiLive, true);
  assert.equal(out.stocks[1].pcr, 1.1);
  assert.equal(out.stocks[1].oiLive, undefined);
  assert.equal(out.indices[0].pcr, 1.2);
  // evening: the file has today's official numbers, live is ignored
  assert.equal(applyOi(data, oi, '2026-11-12'), data);
  assert.equal(applyOi(data, null, '2026-11-11'), data);
  // price down, OI up = short build-up
  assert.equal(applyOi(data, { ...oi, stocks: { A: { futLive: 98, futOiLive: 1200, futCp: 100 } } }, '2026-11-11').stocks[0].futBuildup, 'SHORT BUILDUP');
});
