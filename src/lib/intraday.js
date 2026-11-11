// Scanner rules that mirror the client's Google Sheet (Intraday, Breakout, Swing, Most Active, Index).
// Raw indicators come from latest.json (daily + 5-minute candles); the live price is applied on top,
// so VWAP side, CPR zone, ATM strike and the signal move with every price tick.

import { tradePlan } from './signals.js';

const has = (x) => typeof x === 'number' && Number.isFinite(x);

const INDEX_STEP = { 'NIFTY 50': 50, 'BANK NIFTY': 100, SENSEX: 100 };

// NSE strike gaps differ per stock; these bands match the client sheet on the stocks we compared.
export function strikeStep(price, indexName) {
  if (indexName && INDEX_STEP[indexName]) return INDEX_STEP[indexName];
  if (price < 100) return 5;
  if (price < 250) return 10;
  if (price < 1000) return 20;
  if (price < 2500) return 50;
  if (price < 5000) return 100;
  if (price < 20000) return 250;
  return 500;
}

// `step` = the real strike gap from the NSE bhavcopy when we have it; otherwise the price-band guess.
export function atmStrike(price, indexName, step) {
  if (!has(price) || price <= 0) return null;
  const gap = has(step) && step > 0 ? step : strikeStep(price, indexName);
  return Math.round(Math.round(price / gap) * gap * 100) / 100;
}

export const atmFor = (r, indexName) => atmStrike(r.ltp, indexName, r.step);

export function pcrSentiment(pcr) {
  if (!has(pcr)) return { label: '-', tone: 'flat' };
  if (pcr >= 1.3) return { label: `BULLISH, PUT WRITING (${pcr.toFixed(2)})`, tone: 'up' };
  if (pcr >= 1) return { label: `MILD BULLISH (${pcr.toFixed(2)})`, tone: 'up' };
  if (pcr >= 0.7) return { label: `MILD BEARISH (${pcr.toFixed(2)})`, tone: 'down' };
  return { label: `BEARISH, CALL WRITING (${pcr.toFixed(2)})`, tone: 'down' };
}

export function todayLabel(v) {
  if (!has(v)) return { label: '-', tone: 'flat' };
  if (v >= 2) return { label: 'STRONG BULL', tone: 'up' };
  if (v > 0) return { label: 'BULLISH', tone: 'up' };
  if (v <= -2) return { label: 'STRONG BEAR', tone: 'down' };
  if (v < 0) return { label: 'BEARISH', tone: 'down' };
  return { label: 'FLAT', tone: 'flat' };
}

export function buildupTone(b) {
  if (b === 'LONG BUILDUP' || b === 'SHORT COVERING') return 'up';
  if (b === 'SHORT BUILDUP' || b === 'LONG UNWINDING') return 'down';
  return 'flat';
}

export function rsiStatus(v) {
  if (!has(v)) return { label: '-', tone: 'flat' };
  if (v >= 70) return { label: `OVERBOUGHT (${Math.round(v)})`, tone: 'warn' };
  if (v >= 55) return { label: `BULLISH (${Math.round(v)})`, tone: 'up' };
  if (v <= 30) return { label: `OVERSOLD (${Math.round(v)})`, tone: 'warn' };
  if (v <= 45) return { label: `BEARISH (${Math.round(v)})`, tone: 'down' };
  return { label: `NORMAL (${Math.round(v)})`, tone: 'flat' };
}

export function adxStatus(v) {
  if (!has(v)) return { label: '-', tone: 'flat' };
  if (v >= 25) return { label: `STRONG (${Math.round(v)})`, tone: 'up' };
  if (v >= 20) return { label: `TRENDING (${Math.round(v)})`, tone: 'flat' };
  return { label: `WEAK (${Math.round(v)})`, tone: 'down' };
}

export function macdStatus(m, sig) {
  if (!has(m) || !has(sig)) return { label: '-', tone: 'flat' };
  if (m > sig) return { label: m > 0 ? 'BULLISH (>0)' : 'BULLISH', tone: 'up' };
  return { label: m < 0 ? 'BEARISH (<0)' : 'BEARISH', tone: 'down' };
}

// CPR zone against the live price. Wide = consolidation day, the sheet's "WIDE CONS" no-trade.
export function cprZone(r, c) {
  if (!has(r.cprBc) || !has(r.cprTc)) return null;
  const wide = has(r.cprWidthPct) && r.cprWidthPct > (c.cprWidePct ?? 0.5);
  const inside = r.ltp >= r.cprBc && r.ltp <= r.cprTc;
  return { inside, wide, above: r.ltp > r.cprTc, below: r.ltp < r.cprBc };
}

/**
 * Intraday signal, same order as the sheet: no-trade checks first, then RSI + VWAP + 9/15 EMA + MACD.
 * Returns { signal: 'BUY'|'SELL'|'WAIT'|'NO-TRADE'|'NO DATA', reason, option, plan }.
 */
export function intradaySignal(r, c, indexName) {
  if (!has(r.vwap) || !has(r.ema9i) || !has(r.ema15i)) return { signal: 'NO DATA', reason: 'No 5-minute candles' };
  const zone = cprZone(r, c);
  if (c.cprFilter !== false && zone) {
    if (zone.inside) return { signal: 'NO-TRADE', reason: 'Inside CPR' };
    if (zone.wide) return { signal: 'NO-TRADE', reason: 'Wide CPR (consolidation)' };
  }
  const rsiV = has(r.rsiI) ? r.rsiI : r.rsi;
  const macdUp = has(r.macdI) && has(r.macdIsig) && r.macdI > r.macdIsig;
  const macdDn = has(r.macdI) && has(r.macdIsig) && r.macdI < r.macdIsig;
  const long =
    has(rsiV) && rsiV >= c.bullRsi &&
    (c.requireVwap === false || r.ltp > r.vwap) &&
    (c.requireEma915 === false || r.ema9i > r.ema15i) &&
    (c.macdCross === false || macdUp);
  const short =
    has(rsiV) && rsiV <= c.bearRsi &&
    (c.requireVwap === false || r.ltp < r.vwap) &&
    (c.requireEma915 === false || r.ema9i < r.ema15i) &&
    (c.macdCross === false || macdDn);
  const atm = atmStrike(r.ltp, indexName, r.step);
  if (long) return { signal: 'BUY', reason: 'Above VWAP, 9>15 EMA', option: atm ? `${atm} CE` : null, plan: tradePlan(r, 'BULL', c) };
  if (short) return { signal: 'SELL', reason: 'Below VWAP, 9<15 EMA', option: atm ? `${atm} PE` : null, plan: tradePlan(r, 'BEAR', c) };
  return { signal: 'WAIT', reason: r.ltp > r.vwap ? 'Above VWAP, rules not all met' : 'Below VWAP, rules not all met' };
}

// Daily setup + intraday alignment = the sheet's "Settings Match".
export function settingsMatch(r, intra) {
  if (r.side === 'BULL' && intra.signal !== 'SELL' && intra.signal !== 'NO-TRADE') return { label: `BULL MATCH (${atmFor(r)} CE)`, tone: 'up' };
  if (r.side === 'BEAR' && intra.signal !== 'BUY' && intra.signal !== 'NO-TRADE') return { label: `BEAR MATCH (${atmFor(r)} PE)`, tone: 'down' };
  if (intra.signal === 'NO-TRADE') return { label: intra.reason.toUpperCase(), tone: 'warn' };
  return { label: 'NO', tone: 'flat' };
}

export function breakoutSignal(r, c) {
  const volOk = has(r.volSpike) && r.volSpike >= c.volSpike;
  if (has(r.distHi) && r.distHi >= -2 && volOk && has(r.rsi) && r.rsi >= c.bullRsi) return { label: `BUY (${atmFor(r)} CE)`, tone: 'up', kind: 'up' };
  if (has(r.distLo) && r.distLo <= 2 && volOk && has(r.rsi) && r.rsi <= c.bearRsi) return { label: `SELL (${atmFor(r)} PE)`, tone: 'down', kind: 'down' };
  if ((has(r.distHi) && r.distHi >= -5) || (has(r.distLo) && r.distLo <= 5)) return { label: 'WATCH', tone: 'flat', kind: 'watch' };
  return { label: '-', tone: 'flat', kind: null };
}

export function swingTrend(r) {
  if (![r.ema20, r.ema50, r.ema200].every(has)) return 'SIDEWAYS';
  if (r.ltp > r.ema20 && r.ema20 > r.ema50 && r.ema50 > r.ema200) return 'STRONG BULLISH';
  if (r.ltp > r.ema20 && r.ema20 > r.ema50) return 'BULLISH';
  if (r.ltp < r.ema20 && r.ema20 < r.ema50 && r.ema50 < r.ema200) return 'STRONG BEARISH';
  if (r.ltp < r.ema20 && r.ema20 < r.ema50) return 'BEARISH';
  return 'SIDEWAYS';
}

export function swingSignal(r, c) {
  const trend = swingTrend(r);
  const adxOk = has(r.adx) && r.adx >= c.adx;
  if (trend.endsWith('BULLISH') && adxOk && has(r.rsi) && r.rsi >= c.bullRsi) {
    return { label: `${trend === 'STRONG BULLISH' ? 'STRONG ' : ''}SWING BUY (${atmFor(r)} CE)`, tone: 'up', plan: tradePlan(r, 'BULL', c) };
  }
  if (trend.endsWith('BEARISH') && adxOk && has(r.rsi) && r.rsi <= c.bearRsi) {
    return { label: `${trend === 'STRONG BEARISH' ? 'STRONG ' : ''}SWING SELL (${atmFor(r)} PE)`, tone: 'down', plan: tradePlan(r, 'BEAR', c) };
  }
  return { label: 'WAIT', tone: 'flat', plan: null };
}

// Index view: spot vs VWAP, 9/15 EMA, RSI -> CE / PE bias.
export function indexSignal(ix, c) {
  const intra = intradaySignal(ix, { ...c, cprFilter: false }, ix.name);
  const above = has(ix.vwap) ? ix.ltp > ix.vwap : null;
  let bias = 'NEUTRAL';
  if (above && ix.ema9i > ix.ema15i) bias = 'BULLISH (CALL FAVORED)';
  else if (above === false && ix.ema9i < ix.ema15i) bias = 'BEARISH (PUT FAVORED)';
  return { ...intra, above, bias, atm: atmStrike(ix.ltp, ix.name, ix.step) };
}
