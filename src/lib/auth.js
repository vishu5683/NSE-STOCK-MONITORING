// Admin login for a static site.
//
// IMPORTANT: this is a client-side gate. The password lives in the shipped JavaScript, so anyone who
// reads the source can find it. It stops casual visitors from opening the admin panel and from
// changing the screener settings, but it is NOT real security. Never put secrets, API keys or
// private client data behind it. For real protection add a backend (e.g. Vercel serverless function
// or Cloudflare Access) in front of the site.

// Sign-in screen switch. false = the site opens straight to the dashboard (login code stays below, unused).
// Set to true to bring the password screen back. For the live API also set SITE_PASSWORD on the server.
export const LOGIN_ENABLED = false;

const ADMIN_PASSWORD = 'Vishu@4321';
const SESSION_KEY = 'nsestocks.admin';
const LOCK_KEY = 'nsestocks.lock';
const MAX_TRIES = 5;
const LOCK_MS = 30_000;

function read(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const isAdmin = () => !LOGIN_ENABLED || read(SESSION_KEY) === '1';

export function lockedFor() {
  try {
    const raw = JSON.parse(read(LOCK_KEY) || '{}');
    if (raw.until && raw.until > Date.now()) return Math.ceil((raw.until - Date.now()) / 1000);
  } catch {
    /* ignore */
  }
  return 0;
}

export function login(password) {
  const wait = lockedFor();
  if (wait > 0) return { ok: false, message: `Too many attempts. Try again in ${wait}s.` };

  if (password === ADMIN_PASSWORD) {
    write(SESSION_KEY, '1');
    write(LOCK_KEY, null);
    return { ok: true };
  }
  let tries = 0;
  try {
    tries = (JSON.parse(read(LOCK_KEY) || '{}').tries || 0) + 1;
  } catch {
    tries = 1;
  }
  if (tries >= MAX_TRIES) {
    write(LOCK_KEY, JSON.stringify({ tries: 0, until: Date.now() + LOCK_MS }));
    return { ok: false, message: 'Too many attempts. Locked for 30 seconds.' };
  }
  write(LOCK_KEY, JSON.stringify({ tries }));
  return { ok: false, message: `Wrong password. ${MAX_TRIES - tries} tries left.` };
}

export function logout() {
  write(SESSION_KEY, null);
}

// Used when the server already checked the password (production API).
export function grant() {
  write(SESSION_KEY, '1');
  write(LOCK_KEY, null);
}
