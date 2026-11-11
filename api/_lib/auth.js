// Server-side sign-in for the live price API. This one is real security: the password and the
// signing secret exist only as Vercel environment variables, never in the browser bundle.
//
// SITE_PASSWORD   the password the client types on the sign-in screen
// SESSION_SECRET  long random string used to sign session tokens

import crypto from 'node:crypto';

const TTL_SECONDS = 12 * 60 * 60;
const MAX_TRIES = 5;
const LOCK_MS = 60_000;
const attempts = new Map(); // ip -> { n, until }

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const mac = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('base64url');

export function configured() {
  return Boolean(process.env.SITE_PASSWORD && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16);
}

// When SITE_PASSWORD is not set the live API is open (no sign-in). Set it to turn the sign-in back on.
export function loginRequired() {
  return Boolean(process.env.SITE_PASSWORD);
}

export function passwordOk(input) {
  const want = process.env.SITE_PASSWORD || '';
  if (!want) return false;
  // hash first so both buffers have the same length for timingSafeEqual
  return crypto.timingSafeEqual(sha(input), sha(want));
}

export function lockedFor(ip, now = Date.now()) {
  const a = attempts.get(ip);
  return a?.until && a.until > now ? Math.ceil((a.until - now) / 1000) : 0;
}

export function recordFailure(ip, now = Date.now()) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= MAX_TRIES) {
    a.n = 0;
    a.until = now + LOCK_MS;
  }
  attempts.set(ip, a);
  if (attempts.size > 5000) attempts.clear(); // cheap memory guard
}

export function recordSuccess(ip) {
  attempts.delete(ip);
}

export function issueToken(now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const body = String(exp);
  return { token: `${body}.${mac(body, process.env.SESSION_SECRET)}`, expiresAt: exp * 1000 };
}

export function verifyToken(token, now = Date.now()) {
  if (!configured() || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const body = token.slice(0, dot);
  const given = token.slice(dot + 1);
  const want = mac(body, process.env.SESSION_SECRET);
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const exp = Number(body);
  return Number.isFinite(exp) && exp * 1000 > now;
}

export function bearer(req) {
  const h = String(req.headers?.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
