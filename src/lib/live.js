// Overlay a real Upstox quote on a daily row.
// Missing live numbers stay as the last real daily value, or become null.
// Nothing here invents a price.

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const round2 = (n) => Math.round(n * 100) / 100;

export function applyLive(row, quote) {
  if (!quote || !isNum(quote.ltp) || quote.ltp <= 0) return row;
  const ltp = quote.ltp;
  const prev = isNum(quote.cp) && quote.cp > 0 ? quote.cp : isNum(row.prevClose) && row.prevClose > 0 ? row.prevClose : null;
  const next = {
    ...row,
    ltp,
    chg: prev ? round2((ltp / prev - 1) * 100) : null,
    live: true,
    liveAt: quote.ts || null,
  };
  if (prev) next.prevClose = prev;
  // a live tick outside today's range moves the day high / low (only when the row is today's bar)
  if (isNum(row.high) && isNum(row.low) && quote.sameDay !== false) {
    next.high = Math.max(row.high, ltp);
    next.low = Math.min(row.low, ltp);
  }
  if (isNum(row.hi52) && row.hi52 > 0) {
    const hi = Math.max(row.hi52, ltp);
    next.hi52 = hi;
    next.distHi = round2((ltp / hi - 1) * 100);
  }
  if (isNum(row.lo52) && row.lo52 > 0) {
    const lo = Math.min(row.lo52, ltp);
    next.lo52 = lo;
    next.distLo = round2((ltp / lo - 1) * 100);
  }
  return next;
}

export function applyBook(data, live) {
  if (!data || !live?.quotes) return data;
  return {
    ...data,
    stocks: data.stocks.map((s) => applyLive(s, live.quotes[s.s])),
    indices: data.indices.map((i) => applyLive(i, live.indices?.[i.name])),
  };
}
