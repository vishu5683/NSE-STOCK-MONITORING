// Builds api/_instruments.json: symbol -> Upstox instrument key (ISIN based), plus the 4 index keys.
// The Upstox instrument list is public, no login needed. Run: npm run instruments
// Commit the result. Re-run if a new stock is added to data-pipeline/universe.csv.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const norm = (v) => String(v || '').trim().toLowerCase();

async function load(name) {
  const res = await fetch(`https://assets.upstox.com/market-quote/instruments/exchange/${name}.json.gz`);
  if (!res.ok) throw new Error(`Could not download ${name} instruments (HTTP ${res.status})`);
  return JSON.parse(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
}

const [nse, bse] = await Promise.all([load('NSE'), load('BSE')]);

// EQ series first; a stock moved to trade-for-trade (BE, e.g. HFCL in Nov-2026) is still the same company
const eq = new Map();
for (const series of ['EQ', 'BE']) {
  for (const r of nse) {
    if (r.segment === 'NSE_EQ' && r.instrument_type === series && r.trading_symbol && r.instrument_key && !eq.has(r.trading_symbol)) eq.set(r.trading_symbol, r.instrument_key);
  }
}

const symbols = fs
  .readFileSync(path.join(root, 'data-pipeline', 'universe.csv'), 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(',')[0].trim())
  .filter(Boolean);

const stocks = {};
const missing = [];
for (const s of symbols) {
  const key = eq.get(s);
  if (key) stocks[s] = key;
  else missing.push(s);
}

const all = nse.concat(bse);
const INDEXES = [
  { name: 'NIFTY 50', find: (r) => r.segment === 'NSE_INDEX' && norm(r.name) === 'nifty 50', fallback: 'NSE_INDEX|Nifty 50' },
  { name: 'BANK NIFTY', find: (r) => r.segment === 'NSE_INDEX' && norm(r.name) === 'nifty bank', fallback: 'NSE_INDEX|Nifty Bank' },
  { name: 'INDIA VIX', find: (r) => r.segment === 'NSE_INDEX' && norm(r.name) === 'india vix', fallback: 'NSE_INDEX|India VIX' },
  { name: 'SENSEX', find: (r) => r.segment === 'BSE_INDEX' && (norm(r.name) === 'sensex' || norm(r.trading_symbol) === 'sensex'), fallback: 'BSE_INDEX|SENSEX' },
];
const indices = {};
for (const spec of INDEXES) indices[spec.name] = all.find(spec.find)?.instrument_key || spec.fallback;

const out = { generatedAt: new Date().toISOString(), stocks, indices, missing };
fs.writeFileSync(path.join(root, 'api', '_instruments.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`mapped ${Object.keys(stocks).length} of ${symbols.length} stocks, ${Object.keys(indices).length} indices`);
if (missing.length) console.log('no Upstox key for:', missing.join(', '));
