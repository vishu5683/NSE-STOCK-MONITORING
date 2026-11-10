// Rule engine. Everything is computed in the browser from the raw indicators in latest.json,
// so the admin can change thresholds and the whole app re-filters instantly.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const has = (x) => x !== null && x !== undefined && !Number.isNaN(x);

function bullScore(s, c) {
  let score = 0;
  if (has(s.ema20) && s.ltp > s.ema20) score += 8;
  if (has(s.ema20) && has(s.ema50) && s.ema20 > s.ema50) score += 9;
  if (has(s.ema200) && s.ltp > s.ema200) score += 8;

  if (has(s.rsi)) {
    if (s.rsi >= c.bullRsi && s.rsi <= 75) score += 20;
    else if (s.rsi > 75) score += 12; // strong but stretched
    else if (s.rsi >= 50) score += 8;
  }
  if (has(s.adx) && s.adx >= c.adx) score += clamp(12 + (s.adx - c.adx) / 2, 12, 20);

  if (has(s.volSpike)) {
    if (s.volSpike >= c.volSpike) score += 15;
    else if (s.volSpike >= 1) score += 8;
  }
  if (has(s.distHi)) {
    if (s.distHi >= -2) score += 10;
    else if (s.distHi >= -5) score += 5;
  }
  if (has(s.macd) && has(s.macdSig) && s.macd > s.macdSig) score += s.macd > 0 ? 10 : 5;
  return Math.round(clamp(score, 0, 100));
}

function bearScore(s, c) {
  let score = 0;
  if (has(s.ema20) && s.ltp < s.ema20) score += 8;
  if (has(s.ema20) && has(s.ema50) && s.ema20 < s.ema50) score += 9;
  if (has(s.ema200) && s.ltp < s.ema200) score += 8;

  if (has(s.rsi)) {
    if (s.rsi <= c.bearRsi && s.rsi >= 25) score += 20;
    else if (s.rsi < 25) score += 12; // oversold, bounce risk
    else if (s.rsi <= 50) score += 8;
  }
  if (has(s.adx) && s.adx >= c.adx) score += clamp(12 + (s.adx - c.adx) / 2, 12, 20);

  if (has(s.volSpike)) {
    if (s.volSpike >= c.volSpike) score += 15;
    else if (s.volSpike >= 1) score += 8;
  }
  if (has(s.distLo)) {
    if (s.distLo <= 2) score += 10;
    else if (s.distLo <= 5) score += 5;
  }
  if (has(s.macd) && has(s.macdSig) && s.macd < s.macdSig) score += s.macd < 0 ? 10 : 5;
  return Math.round(clamp(score, 0, 100));
}

export function tradePlan(s, side, c) {
  if (!has(s.atr) || !s.atr) return null;
  const risk = s.atr * c.atrMult;
  const dir = side === 'BULL' ? 1 : -1;
  const r = (v) => Math.round(v * 100) / 100;
  return {
    entry: s.ltp,
    stop: r(s.ltp - dir * risk),
    t1: r(s.ltp + dir * risk * c.rr1),
    t2: r(s.ltp + dir * risk * c.rr2),
    riskPct: r((risk / s.ltp) * 100),
    rr1: c.rr1,
    rr2: c.rr2,
  };
}

export function analyse(s, c) {
  const bull = bullScore(s, c);
  const bear = bearScore(s, c);
  const volOk = has(s.volSpike) && s.volSpike >= c.volSpike;

  const bullOk =
    bull >= c.minScore &&
    has(s.rsi) && s.rsi >= c.bullRsi &&
    has(s.adx) && s.adx >= c.adx &&
    has(s.ema20) && has(s.ema50) && s.ltp > s.ema20 && s.ema20 > s.ema50 &&
    (!c.requireVolume || volOk);

  const bearOk =
    bear >= c.minScore &&
    has(s.rsi) && s.rsi <= c.bearRsi &&
    has(s.adx) && s.adx >= c.adx &&
    has(s.ema20) && has(s.ema50) && s.ltp < s.ema20 && s.ema20 < s.ema50 &&
    (!c.requireVolume || volOk);

  let side = null;
  if (bullOk && (!bearOk || bull >= bear)) side = 'BULL';
  else if (bearOk) side = 'BEAR';

  let setup = null;
  if (side === 'BULL') setup = s.distHi >= -2 && volOk ? 'BREAKOUT + VOLUME' : s.distHi >= -2 ? 'NEAR 52W HIGH' : 'TREND + MOMENTUM';
  if (side === 'BEAR') setup = s.distLo <= 2 && volOk ? 'BREAKDOWN + VOLUME' : s.distLo <= 2 ? 'NEAR 52W LOW' : 'TREND + MOMENTUM';

  return {
    bullScore: bull,
    bearScore: bear,
    side,
    score: side === 'BULL' ? bull : side === 'BEAR' ? bear : Math.max(bull, bear),
    setup,
    volOk,
    plan: side ? tradePlan(s, side, c) : null,
  };
}

export function analyseAll(stocks, c) {
  return stocks.map((s) => ({ ...s, ...analyse(s, c) }));
}

export function marketBreadth(rows) {
  const n = rows.length || 1;
  const adv = rows.filter((r) => r.chg > 0).length;
  const dec = rows.filter((r) => r.chg < 0).length;
  const above50 = rows.filter((r) => has(r.ema50) && r.ltp > r.ema50).length;
  const above200 = rows.filter((r) => has(r.ema200) && r.ltp > r.ema200).length;
  const rsiVals = rows.map((r) => r.rsi).filter(has);
  return {
    total: rows.length,
    adv,
    dec,
    unch: rows.length - adv - dec,
    above50Pct: (above50 / n) * 100,
    above200Pct: (above200 / n) * 100,
    avgRsi: rsiVals.length ? rsiVals.reduce((a, b) => a + b, 0) / rsiVals.length : null,
    bull: rows.filter((r) => r.side === 'BULL').length,
    bear: rows.filter((r) => r.side === 'BEAR').length,
  };
}

export function sectorStats(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.sec)) map.set(r.sec, []);
    map.get(r.sec).push(r);
  }
  const avg = (arr, k) => {
    const v = arr.map((x) => x[k]).filter(has);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  return [...map.entries()]
    .map(([sector, list]) => ({
      sector,
      count: list.length,
      chg: avg(list, 'chg'),
      chg1w: avg(list, 'chg1w'),
      chg1m: avg(list, 'chg1m'),
      bull: list.filter((x) => x.side === 'BULL').length,
      bear: list.filter((x) => x.side === 'BEAR').length,
      adv: list.filter((x) => x.chg > 0).length,
    }))
    .sort((a, b) => b.chg - a.chg);
}

// Status labels (same bands as the client's heatmap sheet).
export function weeklyLabel(v) {
  if (!has(v)) return '-';
  if (v >= 7) return '+7% RALLY';
  if (v >= 3) return 'BULLISH TREND';
  if (v >= 0) return 'MILD UP';
  if (v > -3) return 'MILD DOWN';
  if (v > -7) return 'BEARISH TREND';
  return 'SHARP DROP';
}

export function monthlyLabel(v) {
  if (!has(v)) return '-';
  if (v >= 15) return 'MEGATREND (+15%)';
  if (v >= 7) return 'STRONG RUN';
  if (v >= 0) return 'ACCUMULATION';
  if (v > -7) return 'DISTRIBUTION';
  if (v > -15) return 'HEAVY DROP';
  return 'DRAWDOWN (-15%)';
}

export function convictionLabel(score, side) {
  if (!side) return '-';
  return score >= 85 ? 'VERY HIGH' : score >= 70 ? 'HIGH' : 'MEDIUM';
}

export function breakoutLabel(r) {
  if (has(r.distHi) && r.distHi >= -0.5) return '52W BREAKOUT';
  if (has(r.distHi) && r.distHi >= -2) return 'NEAR 52W HIGH';
  if (has(r.distLo) && r.distLo <= 0.5) return '52W BREAKDOWN';
  if (has(r.distLo) && r.distLo <= 2) return 'NEAR 52W LOW';
  return '';
}
