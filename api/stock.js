import { send } from './_lib/http.js';
import candles from './_candles.js';
import chain from './_chain.js';
import depth from './_depth.js';

// Per-symbol data for the stock popup, one function for three views (Vercel Hobby allows 12
// functions per deployment): /api/stock?kind=candles|chain|depth&s=SYMBOL
const KINDS = { candles, chain, depth };

export default function handler(req, res) {
  const kind = new URL(req.url || '/', 'http://local').searchParams.get('kind');
  const h = KINDS[kind];
  if (!h) return send(res, 400, { error: 'BAD_KIND', message: 'kind must be candles, chain or depth.' });
  return h(req, res);
}
