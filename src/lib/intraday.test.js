import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atmStrike, intradaySignal, settingsMatch, cprZone, breakoutSignal, swingSignal, indexSignal } from './intraday.js';

const C = { minScore: 60, volSpike: 2, bullRsi: 55, bearRsi: 45, adx: 22, atrMult: 1.5, rr1: 1.5, rr2: 2.5, requireVwap: true, requireEma915: true, macdCross: true, cprFilter: true, cprWidePct: 0.5 };
const base = { s: 'X', ltp: 404, vwap: 400, ema9i: 405, ema15i: 402, rsiI: 62, macdI: 1.2, macdIsig: 0.8, cprBc: 380, cprTc: 381, cprWidthPct: 0.2, atr: 12, rsi: 70 };

test('ATM strike matches the client sheet examples', () => {
  assert.equal(atmStrike(403.85), 400);
  assert.equal(atmStrike(649), 640);
  assert.equal(atmStrike(275.06), 280);
  assert.equal(atmStrike(138.82), 140);
  assert.equal(atmStrike(1416.2), 1400);
  assert.equal(atmStrike(88.25), 90);
  assert.equal(atmStrike(480), 480);
  assert.equal(atmStrike(214.75), 210);
  assert.equal(atmStrike(25374.45, 'NIFTY 50'), 25350);
  assert.equal(atmStrike(61218.6, 'BANK NIFTY'), 61200);
  assert.equal(atmStrike(null), null);
});

test('BUY above VWAP with 9>15 EMA, MACD up and RSI >= bull', () => {
  const r = intradaySignal(base, C);
  assert.equal(r.signal, 'BUY');
  assert.equal(r.option, '400 CE');
  assert.equal(r.plan.stop, 386);
});

test('SELL below VWAP with 9<15 EMA', () => {
  const r = intradaySignal({ ...base, ltp: 390, ema9i: 395, ema15i: 398, rsiI: 40, macdI: -1, macdIsig: -0.5, cprBc: 420, cprTc: 421 }, C);
  assert.equal(r.signal, 'SELL');
  assert.equal(r.option, '400 PE');
});

test('no trade inside CPR or on a wide CPR', () => {
  assert.equal(intradaySignal({ ...base, cprBc: 400, cprTc: 410 }, C).reason, 'Inside CPR');
  assert.equal(intradaySignal({ ...base, cprWidthPct: 0.9 }, C).reason, 'Wide CPR (consolidation)');
  assert.equal(intradaySignal({ ...base, cprBc: 400, cprTc: 410 }, { ...C, cprFilter: false }).signal, 'BUY');
});

test('rule switches relax the check', () => {
  const below = { ...base, ltp: 399 };
  assert.equal(intradaySignal(below, C).signal, 'WAIT');
  assert.equal(intradaySignal(below, { ...C, requireVwap: false }).signal, 'BUY');
});

test('missing 5-minute data is reported, not guessed', () => {
  assert.equal(intradaySignal({ s: 'X', ltp: 100 }, C).signal, 'NO DATA');
});

test('live price moves the CPR zone', () => {
  assert.equal(cprZone({ ...base, ltp: 380.5 }, C).inside, true);
  assert.equal(cprZone({ ...base, ltp: 379 }, C).below, true);
});

test('settings match needs the daily side and no opposite intraday signal', () => {
  assert.equal(settingsMatch({ ...base, side: 'BULL' }, { signal: 'BUY' }).label, 'BULL MATCH (400 CE)');
  assert.equal(settingsMatch({ ...base, side: 'BULL' }, { signal: 'SELL' }).label, 'NO');
  assert.equal(settingsMatch({ ...base, side: null }, { signal: 'NO-TRADE', reason: 'Inside CPR' }).label, 'INSIDE CPR');
});

test('breakout and swing signals', () => {
  assert.equal(breakoutSignal({ ...base, distHi: -1, volSpike: 2.3, rsi: 70 }, C).kind, 'up');
  assert.equal(breakoutSignal({ ...base, distHi: -4, distLo: 30, volSpike: 1, rsi: 50 }, C).kind, 'watch');
  const sw = swingSignal({ ...base, ema20: 400, ema50: 390, ema200: 380, adx: 27, rsi: 70 }, C);
  assert.match(sw.label, /^STRONG SWING BUY \(400 CE\)/);
  assert.equal(sw.plan.t2, 449);
});

test('index signal skips the CPR filter and uses the index strike step', () => {
  const ix = { ...base, name: 'NIFTY 50', ltp: 25374, vwap: 25350, ema9i: 25360, ema15i: 25340, cprBc: 25300, cprTc: 25400 };
  const s = indexSignal(ix, C);
  assert.equal(s.atm, 25350);
  assert.equal(s.bias, 'BULLISH (CALL FAVORED)');
  assert.equal(s.signal, 'BUY');
});

import { gapPct, orbStatus, pdStatus, pivots, breakScore, participantView, rangeBreak20, patternTags } from './intraday.js';

test('gap, ORB and previous-day range follow the live price', () => {
  const r = { ltp: 105, dayOpen: 102, pdc: 100, orbHigh: 104, orbLow: 101, pdh: 103, pdl: 98, hi20: 104.5, lo20: 90, vwap: 103 };
  assert.equal(gapPct(r), 2);
  assert.equal(orbStatus(r).kind, 'up');
  assert.equal(orbStatus({ ...r, ltp: 100 }).kind, 'down');
  assert.equal(pdStatus(r).kind, 'up');
  assert.equal(rangeBreak20(r).kind, 'up');
  assert.equal(breakScore(r).label, 'STRONG BULL (4/4)');
  assert.equal(orbStatus({ ltp: 1 }).kind, null);
});

test('classic pivots from previous high / low / close', () => {
  const p = pivots({ pdh: 110, pdl: 90, pdc: 100 });
  assert.deepEqual(p, { P: 100, R1: 110, S1: 90, R2: 120, S2: 80, R3: 130, S3: 70 });
  assert.equal(pivots({ pdh: 1 }), null);
});

test('pattern tags and participant view', () => {
  assert.deepEqual(patternTags({ nr7: true, insideBar: true, streak: 4 }), ['NR7', 'INSIDE BAR', '4 UP DAYS']);
  const v = participantView({ idxFutLong: 52382, idxFutShort: 143123, idxCallLong: 10, idxPutLong: 4, chg: { idxFutLong: 3726, idxFutShort: -5949 } });
  assert.equal(v.idxFutLongPct, 26.8);
  assert.equal(v.idxFutNet, -90741);
  assert.equal(v.idxFutNetChg, 9675);
  assert.equal(v.idxOptBias, 6);
});
