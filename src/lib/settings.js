// Settings = defaults shipped in public/config.json, overlaid by what the admin saved in this browser.
// Browser-saved settings only affect this browser. To change them for every visitor, use
// Admin > "Export settings", paste the JSON into public/config.json and redeploy.

const KEY = 'nsestocks.settings.v1';

const FALLBACK = {
  clientName: 'NSE Stocks Pro',
  tagline: 'F&O stock screener and market dashboard',
  accent: '#4f8cff',
  disclaimer:
    'Rule-based research output for information only. It is not investment advice. Data is delayed and may contain errors.',
  screener: {
    minScore: 60,
    volSpike: 2,
    bullRsi: 55,
    bearRsi: 45,
    adx: 22,
    atrMult: 1.5,
    rr1: 1.5,
    rr2: 2.5,
    requireVolume: false,
    requireVwap: true,
    requireEma915: true,
    macdCross: true,
    cprFilter: true,
    cprWidePct: 0.5,
  },
  hidden: [],
  watchlist: [],
};

function merge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = { ...base };
  for (const k of Object.keys(extra)) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && base[k] && typeof base[k] === 'object') {
      out[k] = merge(base[k], extra[k]);
    } else {
      out[k] = extra[k];
    }
  }
  return out;
}

export async function loadSettings() {
  let shipped = {};
  try {
    const res = await fetch(`./config.json?v=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) shipped = await res.json();
  } catch {
    /* config.json is optional */
  }
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* ignore corrupted storage */
  }
  return merge(merge(FALLBACK, shipped), saved);
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings just won't persist */
  }
}

export function clearSavedSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
