import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './ui.jsx';
import { ALERT_PREFS, setPref, useAlertPref } from '../lib/alertPrefs.js';
import { getWatch, unwatchScreen } from '../lib/alerts.js';

function Switch({ pref }) {
  const on = useAlertPref(pref.key);
  return (
    <label className="alert-switch">
      <span>
        <strong>{pref.label}</strong>
        <span className="muted small">{pref.desc}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => setPref(pref.key, e.target.checked)} aria-label={pref.label} />
      <span className="alert-switch-ui" aria-hidden="true" />
    </label>
  );
}

const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

export default function AlertsPanel({ onGoLens }) {
  const [open, setOpen] = useState(false);
  const [watch, setWatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const sheetOn = useAlertPref(ALERT_PREFS[0].key);
  const lensOn = useAlertPref(ALERT_PREFS[1].key);

  useEffect(() => {
    if (!open) return undefined;
    let dead = false;
    getWatch().then((w) => !dead && setWatch(w));
    return () => {
      dead = true;
    };
  }, [open]);

  const remove = async (name) => {
    setBusy(true);
    const r = await unwatchScreen(name);
    if (r?.screens) setWatch((w) => ({ ...(w || {}), screens: r.screens }));
    setBusy(false);
  };

  const watchedCount = watch?.screens?.length || 0;
  const anyOn = sheetOn || lensOn;

  return (
    <>
      <button className={`btn sm ${anyOn ? 'primary' : 'ghost'}`} onClick={() => setOpen(true)} aria-label="Alerts" title="Alerts">
        {anyOn ? '🔔' : '🔕'}
        <span className="alert-text"> Alerts</span>
      </button>
      {/* portal: the header's backdrop-filter would otherwise trap the fixed popup inside the header */}
      {open && createPortal(
        <Modal onClose={() => setOpen(false)} label="Alerts" title="Alerts">
          <div className="alerts-panel">
            <h3>On this device</h3>
            <p className="muted small">Pop-up and sound while this site is open in the browser.</p>
            {ALERT_PREFS.map((p) => (
              <Switch key={p.key} pref={p} />
            ))}

            <h3>Telegram (works with the browser closed)</h3>
            {watch === null && <p className="muted small">Loading…</p>}
            {watch && watch.configured === false && <p className="muted small">Server alerts are not set up on this site.</p>}
            {watch?.error && <p className="muted small">Server alerts are not reachable right now.</p>}
            {watch?.configured && (
              <>
                {watchedCount ? (
                  <ul className="alerts-watched">
                    {watch.screens.map((s) => (
                      <li key={s.name}>
                        <span>📡 {s.name}</span>
                        <button className="btn ghost sm" onClick={() => remove(s.name)} disabled={busy} aria-label={`Stop watching ${s.name}`}>
                          Stop
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No screens watched yet.</p>
                )}
                <p className="muted small">
                  To add one, open a screen in Lens and press 📡 Watch.
                  {watch.lastScan?.at ? ` Last check ${fmtTime(watch.lastScan.at)} IST.` : ''}
                </p>
                {onGoLens && (
                  <button className="btn sm" onClick={() => { setOpen(false); onGoLens(); }}>
                    Open Lens
                  </button>
                )}
              </>
            )}
          </div>
        </Modal>,
        document.body,
      )}
    </>
  );
}
