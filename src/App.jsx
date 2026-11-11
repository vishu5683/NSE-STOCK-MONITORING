import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { loadSettings, saveSettings } from './lib/settings.js';
import { analyseAll, marketBreadth, sectorStats } from './lib/signals.js';
import { ageText, hoursSince } from './lib/fmt.js';
import { applyBook, applyIntraday, applyOi } from './lib/live.js';
import { fetchLive, fetchIntraday, fetchOi, probe, pollMs, hasToken, clearToken, marketOpenNow, marketPhaseNow } from './lib/liveApi.js';
import { logout, LOGIN_ENABLED } from './lib/auth.js';
import Dashboard from './components/Dashboard.jsx';
import Screener from './components/Screener.jsx';
import Scanners from './components/Scanners.jsx';
import Reports from './components/Reports.jsx';
import { DOWNLOADS_ENABLED } from './lib/features.js';
import Admin from './components/Admin.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import { isAdmin } from './lib/auth.js';
import StockModal from './components/StockModal.jsx';

const TABS = [
  { id: 'scanners', label: 'Pro Sheet', icon: 'M4 18l5-6 4 3 7-9M4 4v16h16' },
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z' },
  { id: 'screener', label: 'Screener', icon: 'M3 5h18l-7 8v6l-4 2v-8z' },
  ...(DOWNLOADS_ENABLED ? [{ id: 'reports', label: 'Reports', icon: 'M12 3v12m0 0l-5-5m5 5l5-5M4 21h16' }] : []),
  { id: 'admin', label: 'Admin', icon: 'M7 10V7a5 5 0 0110 0v3M5 10h14v11H5z' },
];
const REFRESH_MS = 10 * 60 * 1000;

// newest quote time in the live payload (to spot a holiday: clock says open, no ticks)
const newestTick = (live) => {
  let best = null;
  for (const q of Object.values(live?.quotes || {})) if (q?.ts && (!best || q.ts > best)) best = q.ts;
  return best;
};

const tabFromHash = () => {
  const id = window.location.hash.replace('#/', '');
  return TABS.some((t) => t.id === id) ? id : 'scanners';
};

export default function App() {
  const [authed, setAuthed] = useState(isAdmin());
  const [settings, setSettings] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(tabFromHash());
  const [picked, setPicked] = useState(null);
  const [live, setLive] = useState(null);
  const [intra, setIntra] = useState(null);
  const [oi, setOi] = useState(null);
  const [sectorFilter, setSectorFilter] = useState('');
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('nsestocks.theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, res] = await Promise.all([loadSettings(), fetch(`./data/latest.json?v=${Date.now()}`, { cache: 'no-store' })]);
      if (!res.ok) throw new Error(`Data file not found (HTTP ${res.status})`);
      setSettings(s);
      setData(await res.json());
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Pick up a new data file without a manual reload (the workflow publishes a few times a day).
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`./data/latest.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const next = await res.json();
        setData((cur) => (cur && cur.meta.generatedAt === next.meta.generatedAt ? cur : next));
      } catch {
        /* offline: keep what we have */
      }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !authed) return undefined;
    const es = new EventSource('/api/upstox/stream');
    es.onmessage = (ev) => {
      try {
        setLive(JSON.parse(ev.data));
      } catch {
        /* ignore a bad frame */
      }
    };
    return () => es.close();
  }, [authed]);

  // Production live prices: poll the signed-in /api/quotes. Quietly absent on static hosting.
  useEffect(() => {
    if (import.meta.env.DEV || !authed || (LOGIN_ENABLED && !hasToken())) return undefined;
    let timer = null;
    let stopped = false;
    let misses = 0;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const r = await fetchLive();
        if (stopped) return;
        if (r.needsLogin) {
          setLive({ authed: false, connected: false, message: 'The live server asks for a login. Set LOGIN_ENABLED to true, or remove SITE_PASSWORD on the server.' });
          return;
        }
        if (r.expired) {
          clearToken();
          logout();
          setAuthed(false);
          return;
        }
        if (r.state) {
          misses = 0;
          setLive(r.state);
        } else {
          misses += 1;
          setLive((cur) => ({ ...(cur || {}), authed: true, connected: false, message: r.error }));
        }
      }
      // back off while the service is failing (10s, 20s, 40s ... up to 60s)
      const wait = misses ? Math.min(60000, pollMs() * 2 ** Math.min(misses, 4)) : pollMs();
      timer = setTimeout(tick, wait);
    };
    // static hosting has no /api: do not poll a 404 forever
    probe().then((p) => {
      if (stopped) return;
      if (p.available && p.live) tick();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible' && timer) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authed]);

  // Live 5-minute indicators: once a minute while the market is open, once when it is closed.
  useEffect(() => {
    if (import.meta.env.DEV || !authed || (LOGIN_ENABLED && !hasToken())) return undefined;
    let timer = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const body = await fetchIntraday();
        if (stopped) return;
        if (body) setIntra(body);
      }
      if (marketOpenNow()) timer = setTimeout(tick, 60000);
    };
    probe().then((p) => {
      if (!stopped && p.available && p.live) tick();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [authed]);

  // Live option chains + futures OI: every 5 minutes while the market is open, once otherwise.
  useEffect(() => {
    if (import.meta.env.DEV || !authed || (LOGIN_ENABLED && !hasToken())) return undefined;
    let timer = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const body = await fetchOi();
        if (stopped) return;
        if (body) setOi(body);
      }
      if (marketOpenNow()) timer = setTimeout(tick, 5 * 60000);
    };
    probe().then((p) => {
      if (!stopped && p.available && p.live) tick();
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [authed]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('nsestocks.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.style.setProperty('--accent', settings.accent);
    document.title = `${settings.clientName} | NSE F&O Screener`;
  }, [settings]);

  const updateSettings = useCallback((next) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const toggleWatch = useCallback(
    (sym) => {
      if (!settings) return;
      const list = settings.watchlist || [];
      updateSettings({ ...settings, watchlist: list.includes(sym) ? list.filter((x) => x !== sym) : [...list, sym] });
    },
    [settings, updateSettings],
  );

  const book = useMemo(() => (data ? applyOi(applyIntraday(applyBook(data, live), intra), oi, data.meta?.foDate) : null), [data, live, intra, oi]);
  // live OI applies only while the file's NSE F&O date is older than the live session
  const oiLive = Boolean(oi?.day && data?.meta && (!data.meta.foDate || data.meta.foDate < oi.day));

  const rows = useMemo(() => {
    if (!book || !settings) return [];
    const hidden = new Set(settings.hidden || []);
    return analyseAll(
      book.stocks.filter((s) => !hidden.has(s.s)),
      settings.screener,
    );
  }, [book, settings]);

  const breadth = useMemo(() => marketBreadth(rows), [rows]);
  const sectors = useMemo(() => sectorStats(rows), [rows]);

  const go = (id) => {
    window.location.hash = `#/${id}`;
    window.scrollTo({ top: 0 });
  };

  if (!authed) return <LoginScreen name="NSE Stocks Pro" tagline="Sign in to open the dashboard" onDone={() => setAuthed(true)} />;
  if (error) {
    return (
      <div className="boot">
        <div className="card boot-card">
          <h1>Could not load data</h1>
          <p className="error">{error}</p>
          <p className="muted small">
            Run <code>npm run data</code> once to create <code>public/data/latest.json</code>, or check that the data workflow has run.
          </p>
          {import.meta.env.DEV && (
            <p className="muted small">
              Live prices need that file plus an Upstox login. <a href="/api/upstox/login">Log in to Upstox</a>
            </p>
          )}
          <button className="btn primary" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!data || !settings) {
    return (
      <div className="boot">
        <div className="spinner" aria-label="Loading" />
        <p className="muted">Loading market data…</p>
      </div>
    );
  }

  const meta = data.meta;
  const stale = hoursSince(meta.generatedAt) > 96;
  const ctx = { rows, indices: book.indices, sectors, breadth, meta, settings };
  const liveOn = Boolean(live?.connected);
  const watched = picked ? (settings.watchlist || []).includes(picked.s) : false;
  const openSheet = (view) => {
    try {
      localStorage.setItem('nsestocks.scanView', view);
    } catch {
      /* ignore */
    }
    go('scanners');
  };
  const openSector = (sec) => {
    setSectorFilter(sec);
    go('screener');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('scanners')} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go('scanners')}>
          <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--accent)" />
            <path d="M10 44 24 28l9 8 21-20" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M42 16h12v12" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <strong>{settings.clientName}</strong>
            <small>{settings.tagline}</small>
          </div>
        </div>
        <nav className="tabs" aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
              <svg className="tab-ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
                <path d={t.icon} />
              </svg>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topright">
          <div className="status" title={liveOn ? (live.source === 'yahoo' ? 'Yahoo Finance prices' : 'Upstox live price') : meta.source}>
            <span className={`dot ${liveOn ? 'ok' : stale ? 'warn' : 'ok'}`} />
            <span>
              {liveOn ? `${live.source === 'yahoo' ? 'Live (Yahoo)' : 'Upstox live'} · ${ageText(live.updatedAt) || 'now'}` : `${meta.lastTradingDate} · ${ageText(meta.generatedAt)}`}
            </span>
          </div>
          <button className="btn ghost sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="content">
        <div className="data-strip">
          <span className={`dot ${liveOn ? 'ok' : stale ? 'warn' : 'ok'}`} />{' '}
          {liveOn ? `${live.source === 'yahoo' ? 'Live (Yahoo)' : 'Upstox live'} · ${ageText(live.updatedAt) || 'now'}` : `Data ${meta.lastTradingDate} · updated ${ageText(meta.generatedAt)}`} · {marketPhaseNow(new Date(), liveOn ? newestTick(live) : null).label}
        </div>
        {import.meta.env.DEV && live && !live.authed && (
          <div className="banner warn">
            {live.message}{' '}
            {live.configured && (
              <a href="/api/upstox/login">Log in to Upstox</a>
            )}
          </div>
        )}
        {import.meta.env.DEV && live?.authed && !live.connected && live.message && <div className="banner warn">{live.message}</div>}
        {liveOn && (
          <details className={`banner live-note ${live.stale || live.partial ? 'warn' : 'info'}`}>
            <summary>
              {live.source === 'yahoo' ? 'Live prices (Yahoo)' : 'Upstox live prices'} · {live.mapped} stocks
              {intra?.count ? ` · intraday indicators every 2 min` : ''}
              {oiLive ? ` · OI live (Upstox, every 5 min)` : meta.foDate ? ` · OI: NSE close ${meta.foDate}` : ''}
              {live.stale ? ' · showing last good prices' : ''}
            </summary>
            <p>
              {live.source === 'yahoo'
                ? `Prices from Yahoo Finance (${live.mapped} symbols, unofficial feed, usually within a minute for NSE stocks, SENSEX about 15 minutes late).`
                : `Upstox live prices are on (${live.mapped} symbols).`}{' '}
              {intra?.count
                ? `Intraday VWAP, EMA 9/15, RSI, MACD, opening range and CPR are live for ${intra.count} stocks (5-minute candles, refreshed every 2 minutes). Daily RSI / ADX / EMA and NSE OI come from the last data refresh.`
                : 'RSI, EMA, ADX, VWAP and volume spike come from the last data refresh; VWAP side, CPR zone, ATM strike and scanner signals follow the live price.'}
              {live.source !== 'yahoo' && live.unmapped?.length > 0 ? ` No Upstox key for: ${live.unmapped.join(', ')}.` : ''}
              {live.stale ? ` Showing the last good prices: ${live.warning}` : ''}
              {live.partial && !live.stale ? ' Some prices could not be refreshed this round.' : ''}
            </p>
          </details>
        )}
        {!import.meta.env.DEV && live && !live.connected && live.message && <div className="banner warn">Live prices paused: {live.message}</div>}
        {liveOn && live.source === 'yahoo' && live.fallbackReason && live.fallbackReason !== 'Upstox token is not set.' && (
          <div className="banner warn">
            Upstox is not answering ({live.fallbackReason}). Prices continue from Yahoo and OI shows the last NSE close. If this stays, generate a new Upstox Analytics Token and update UPSTOX_ANALYTICS_TOKEN in Vercel.
          </div>
        )}
        {meta.health?.some((h) => !h.ok) && (
          <div className="banner warn">
            Data check warning:{' '}
            {meta.health
              .filter((h) => !h.ok)
              .map((h) => `${h.name} (${h.detail})`)
              .join('; ')}
          </div>
        )}
        {stale && <div className="banner warn">Data looks old (generated {ageText(meta.generatedAt)}). The scheduled update may have failed. Check the data workflow.</div>}
        {meta.failed?.length > 0 && tab === 'dashboard' && (
          <div className="banner info">
            {meta.failed.length} symbols could not be loaded and are excluded: {meta.failed.slice(0, 8).join(', ')}
            {meta.failed.length > 8 ? '…' : ''}
          </div>
        )}

        {tab === 'dashboard' && <Dashboard rows={rows} indices={book.indices} breadth={breadth} sectors={sectors} onOpen={setPicked} onGoScreener={openSector} onGoSheet={openSheet} settings={settings} meta={meta} />}
        {tab === 'scanners' && <Scanners rows={rows} indices={book.indices} sectors={sectors} settings={settings} onOpen={setPicked} onSector={openSector} meta={meta} oiInfo={oiLive ? oi : null} />}
        {tab === 'screener' && (
          <Screener rows={rows} sectors={sectors} initialSector={sectorFilter} watchlist={settings.watchlist || []} onOpen={setPicked} onToggleWatch={toggleWatch} />
        )}
        {DOWNLOADS_ENABLED && tab === 'reports' && <Reports ctx={ctx} />}
        {tab === 'admin' && <Admin settings={settings} onChange={updateSettings} meta={meta} universe={book.stocks.map((s) => s.s)} stocks={book.stocks} />}
      </main>

      <footer className="footer">
        <p>{settings.disclaimer}</p>
        <details>
          <summary>How the numbers are made</summary>
          <ul className="plain small">
            <li>
              Source: {meta.source}. Last data date {meta.lastTradingDate}, file generated {meta.generatedAtIST}.
            </li>
            {meta.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>
              Score (0-100) adds points for EMA trend, RSI zone, ADX strength, volume spike, closeness to the 52-week extreme and MACD. A stock is a setup only when it also meets the RSI, ADX and EMA rules set in Admin.
            </li>
            <li>Stop loss and targets are ATR-based mechanical levels.</li>
          </ul>
        </details>
      </footer>

      {picked && <StockModal stock={rows.find((r) => r.s === picked.s) || picked} onClose={() => setPicked(null)} watched={watched} onToggleWatch={toggleWatch} />}
    </div>
  );
}
