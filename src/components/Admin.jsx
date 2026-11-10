import React, { useMemo, useState } from 'react';
import { Card } from './ui.jsx';
import { isAdmin, login, logout, lockedFor } from '../lib/auth.js';
import { clearSavedSettings } from '../lib/settings.js';
import { ageText } from '../lib/fmt.js';
import { analyseAll } from '../lib/signals.js';

const RULE_PRESETS = {
  Conservative: { minScore: 75, volSpike: 1.5, bullRsi: 58, bearRsi: 42, adx: 22, atrMult: 2, rr1: 1.5, rr2: 2.5, requireVolume: true },
  Balanced: { minScore: 60, volSpike: 1.25, bullRsi: 53, bearRsi: 47, adx: 18, atrMult: 1.5, rr1: 2, rr2: 3, requireVolume: false },
  Aggressive: { minScore: 50, volSpike: 1.1, bullRsi: 51, bearRsi: 49, adx: 15, atrMult: 1.2, rr1: 2, rr2: 3.5, requireVolume: false },
};

function validate(sc) {
  const e = [];
  const num = (k) => typeof sc[k] === 'number' && Number.isFinite(sc[k]);
  if (!['minScore', 'volSpike', 'bullRsi', 'bearRsi', 'adx', 'atrMult', 'rr1', 'rr2'].every(num)) e.push('Every rule needs a number.');
  if (num('minScore') && (sc.minScore < 0 || sc.minScore > 100)) e.push('Minimum score must be between 0 and 100.');
  if (num('bullRsi') && num('bearRsi') && sc.bullRsi <= sc.bearRsi) e.push('Bullish RSI must be higher than bearish RSI.');
  if (num('bullRsi') && (sc.bullRsi < 1 || sc.bullRsi > 99)) e.push('Bullish RSI must be between 1 and 99.');
  if (num('bearRsi') && (sc.bearRsi < 1 || sc.bearRsi > 99)) e.push('Bearish RSI must be between 1 and 99.');
  if (num('volSpike') && sc.volSpike <= 0) e.push('Volume spike must be above 0.');
  if (num('atrMult') && sc.atrMult <= 0) e.push('Stop loss multiplier must be above 0.');
  if (num('rr1') && sc.rr1 <= 0) e.push('Target 1 multiplier must be above 0.');
  if (num('rr1') && num('rr2') && sc.rr2 <= sc.rr1) e.push('Target 2 must be further than Target 1.');
  return e;
}

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const res = login(pw);
    if (res.ok) onDone();
    else {
      setMsg(res.message);
      setPw('');
    }
  };
  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <div className="lock">🔒</div>
        <h2>Admin sign in</h2>
        <p className="muted small">Enter the admin password to change branding, screener rules and view data health.</p>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" disabled={lockedFor() > 0} />
        </label>
        {msg && <p className="error" role="alert">{msg}</p>}
        <button className="btn primary block" type="submit" disabled={!pw}>
          Sign in
        </button>
      </form>
    </div>
  );
}

const NumField = ({ label, hint, value, onChange, step = 1, min, max }) => (
  <label className="field">
    <span>{label}</span>
    <input className="input" type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
    {hint && <small className="muted">{hint}</small>}
  </label>
);

function Panel({ settings, onChange, meta, universe, stocks, onLogout }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(settings)));
  const [saved, setSaved] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState('');
  const sc = draft.screener;

  const setTop = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  };
  const setSc = (k, v) => {
    setDraft((d) => ({ ...d, screener: { ...d.screener, [k]: v } }));
    setSaved(false);
  };

  const cleanSymbols = (txt) =>
    [...new Set(String(txt).split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))].filter((x) => universe.includes(x));

  const errors = validate(sc);
  const count = (rules) => {
    const hidden = new Set(settings.hidden || []);
    const rows = analyseAll(stocks.filter((x) => !hidden.has(x.s)), rules);
    return { bull: rows.filter((r) => r.side === 'BULL').length, bear: rows.filter((r) => r.side === 'BEAR').length };
  };
  const live = useMemo(() => count(settings.screener), [settings, stocks]);
  const preview = useMemo(() => (errors.length ? null : count(sc)), [draft, stocks]);
  const activePreset = Object.keys(RULE_PRESETS).find((k) => Object.entries(RULE_PRESETS[k]).every(([key, val]) => sc[key] === val));
  const applyPreset = (k) => {
    setDraft((d) => ({ ...d, screener: { ...RULE_PRESETS[k] } }));
    setSaved(false);
  };

  const [hiddenText, setHiddenText] = useState((settings.hidden || []).join(', '));
  const [watchText, setWatchText] = useState((settings.watchlist || []).join(', '));

  const save = () => {
    if (errors.length) return;
    const next = {
      ...draft,
      screener: Object.fromEntries(Object.entries(draft.screener).map(([k, v]) => [k, typeof v === 'boolean' ? v : Number(v) || 0])),
      hidden: cleanSymbols(hiddenText),
      watchlist: cleanSymbols(watchText),
    };
    onChange(next);
    setHiddenText(next.hidden.join(', '));
    setWatchText(next.watchlist.join(', '));
    setSaved(true);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ ...draft, hidden: cleanSymbols(hiddenText), watchlist: cleanSymbols(watchText) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const doImport = () => {
    try {
      const obj = JSON.parse(importText);
      if (!obj || typeof obj !== 'object' || !obj.screener) throw new Error('Missing "screener" section');
      onChange({ ...draft, ...obj, screener: { ...draft.screener, ...obj.screener } });
      setDraft((d) => ({ ...d, ...obj, screener: { ...d.screener, ...obj.screener } }));
      setHiddenText((obj.hidden || []).join(', '));
      setWatchText((obj.watchlist || []).join(', '));
      setImportErr('');
      setImportText('');
      setSaved(true);
    } catch (e) {
      setImportErr(`Invalid settings JSON: ${e.message}`);
    }
  };

  const reset = () => {
    if (!window.confirm('Remove the settings saved in this browser and go back to the shipped config?')) return;
    clearSavedSettings();
    window.location.reload();
  };

  return (
    <>
      <Card
        title="Admin panel"
        right={
          <div className="row gap">
            <button className="btn primary" onClick={save} disabled={errors.length > 0}>Save changes</button>
            <button className="btn ghost" onClick={onLogout}>Sign out</button>
          </div>
        }
      >
        {saved && <p className="okmsg" role="status">Saved. The dashboard, screener and reports now use these settings in this browser.</p>}
        <p className="muted small">
          Changes are stored in this browser. To publish them for every visitor, use <strong>Export settings</strong> below, paste the JSON into <code>public/config.json</code> and redeploy.
        </p>
      </Card>

      <div className="grid-2">
        <Card title="Branding">
          <label className="field"><span>Client / product name</span><input className="input" value={draft.clientName} onChange={(e) => setTop('clientName', e.target.value)} maxLength={60} /></label>
          <label className="field"><span>Tagline</span><input className="input" value={draft.tagline} onChange={(e) => setTop('tagline', e.target.value)} maxLength={90} /></label>
          <label className="field"><span>Accent colour</span>
            <div className="row gap"><input type="color" value={draft.accent} onChange={(e) => setTop('accent', e.target.value)} aria-label="Accent colour" /><code>{draft.accent}</code></div>
          </label>
          <label className="field"><span>Disclaimer (shown in footer and every PDF page)</span>
            <textarea className="input" rows={4} value={draft.disclaimer} onChange={(e) => setTop('disclaimer', e.target.value)} />
          </label>
        </Card>

        <Card
          title="Screener rules"
          right={
            <div className="seg" aria-label="Rule presets">
              {Object.keys(RULE_PRESETS).map((k) => (
                <button key={k} type="button" className={activePreset === k ? 'on' : ''} onClick={() => applyPreset(k)}>
                  {k}
                </button>
              ))}
            </div>
          }
        >
          <div className="preview" role="status">
            {preview ? (
              <>
                <span>With these rules:</span>
                <strong className="up-t">{preview.bull} bullish</strong>
                <strong className="down-t">{preview.bear} bearish</strong>
                <span className="muted">(live now: {live.bull} / {live.bear})</span>
              </>
            ) : (
              <span className="error">Fix the rules to see a preview.</span>
            )}
          </div>
          {errors.map((e) => (
            <p key={e} className="error small">{e}</p>
          ))}
          <div className="form-grid">
            <NumField label="Minimum score (0-100)" value={sc.minScore} onChange={(v) => setSc('minScore', v)} min={0} max={100} />
            <NumField label="Volume spike (x)" hint="vs 20-day average" value={sc.volSpike} onChange={(v) => setSc('volSpike', v)} step={0.05} min={0} />
            <NumField label="Bullish RSI at least" value={sc.bullRsi} onChange={(v) => setSc('bullRsi', v)} min={0} max={100} />
            <NumField label="Bearish RSI at most" value={sc.bearRsi} onChange={(v) => setSc('bearRsi', v)} min={0} max={100} />
            <NumField label="ADX at least" hint="trend strength" value={sc.adx} onChange={(v) => setSc('adx', v)} min={0} max={100} />
            <NumField label="Stop loss = ATR x" value={sc.atrMult} onChange={(v) => setSc('atrMult', v)} step={0.1} min={0.1} />
            <NumField label="Target 1 = risk x" value={sc.rr1} onChange={(v) => setSc('rr1', v)} step={0.1} min={0.1} />
            <NumField label="Target 2 = risk x" value={sc.rr2} onChange={(v) => setSc('rr2', v)} step={0.1} min={0.1} />
          </div>
          <label className="check">
            <input type="checkbox" checked={!!sc.requireVolume} onChange={(e) => setSc('requireVolume', e.target.checked)} />
            <span>Require the volume spike for a setup (fewer, stronger signals)</span>
          </label>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Stock lists">
          <label className="field"><span>Hidden symbols (excluded everywhere)</span>
            <textarea className="input" rows={3} value={hiddenText} onChange={(e) => { setHiddenText(e.target.value); setSaved(false); }} placeholder="e.g. YESBANK, IDEA" />
          </label>
          <label className="field"><span>Watchlist</span>
            <textarea className="input" rows={3} value={watchText} onChange={(e) => { setWatchText(e.target.value); setSaved(false); }} placeholder="e.g. RELIANCE, TCS, HDFCBANK" />
          </label>
          <small className="muted">{universe.length} symbols are available. Unknown symbols are dropped when you save.</small>
        </Card>

        <Card title="Data health">
          <div className="grid-stats">
            <div className="stat"><span>Last trading date</span><strong>{meta.lastTradingDate}</strong></div>
            <div className="stat"><span>File generated</span><strong>{meta.generatedAtIST}</strong><small className="muted">{ageText(meta.generatedAt)}</small></div>
            <div className="stat"><span>Loaded / universe</span><strong>{meta.loaded} / {meta.universe}</strong></div>
            <div className="stat"><span>Market phase</span><strong>{meta.marketPhase}</strong></div>
          </div>
          {meta.health?.length > 0 && (
            <ul className="health">
              {meta.health.map((h) => (
                <li key={h.name} className={h.ok ? 'pass' : 'fail'}>
                  <span>{h.ok ? '✓' : '!'}</span>
                  <strong>{h.name}</strong>
                  <em>{h.detail}</em>
                </li>
              ))}
            </ul>
          )}
          <p className="small mt"><span className="muted">Source: </span>{meta.source}</p>
          <p className="small">
            <span className="muted">Failed symbols: </span>
            {meta.failed?.length ? meta.failed.join(', ') : 'none'}
          </p>
          <p className="muted small">Data refreshes automatically on the schedule in <code>.github/workflows</code>. To refresh now, run the "Update data and deploy" workflow in GitHub Actions. If a refresh fails, the workflow opens a GitHub issue and GitHub emails the repo owner.</p>
        </Card>
      </div>

      <Card title="Backup and restore settings">
        <div className="row gap wrap">
          <button className="btn ghost" onClick={exportJson}>Export settings (config.json)</button>
          <button className="btn danger" onClick={reset}>Reset this browser to shipped config</button>
        </div>
        <label className="field mt"><span>Import settings JSON</span>
          <textarea className="input mono" rows={4} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"clientName": "...", "screener": {...}}' />
        </label>
        {importErr && <p className="error">{importErr}</p>}
        <button className="btn ghost" onClick={doImport} disabled={!importText.trim()}>Import</button>
      </Card>
    </>
  );
}

export default function Admin(props) {
  const [authed, setAuthed] = useState(isAdmin());
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <Panel
      {...props}
      onLogout={() => {
        logout();
        setAuthed(false);
      }}
    />
  );
}
