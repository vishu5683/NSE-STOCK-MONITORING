const nf = (d) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const f2 = nf(2);
const f0 = nf(0);

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export const price = (x) => (isNum(x) ? f2.format(x) : '-');
export const int = (x) => (isNum(x) ? f0.format(x) : '-');
export const dec = (x, d = 1) => (isNum(x) ? nf(d).format(x) : '-');
export const pct = (x, d = 2) => (isNum(x) ? `${x > 0 ? '+' : ''}${nf(d).format(x)}%` : '-');
export const mult = (x) => (isNum(x) ? `${nf(2).format(x)}x` : '-');

export function compact(x) {
  if (!isNum(x)) return '-';
  const a = Math.abs(x);
  if (a >= 1e7) return `${nf(2).format(x / 1e7)} Cr`;
  if (a >= 1e5) return `${nf(2).format(x / 1e5)} L`;
  if (a >= 1e3) return `${nf(1).format(x / 1e3)} K`;
  return f0.format(x);
}

export const tone = (x) => (!isNum(x) || x === 0 ? 'flat' : x > 0 ? 'up' : 'down');

export function ageText(iso) {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 90) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function hoursSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}
