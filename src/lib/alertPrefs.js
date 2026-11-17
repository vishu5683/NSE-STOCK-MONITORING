import { useEffect, useState } from 'react';

// Browser alert switches, shared by the header Alerts panel and the pages that raise the alerts.
export const ALERT_PREFS = [
  { key: 'nsestocks.alerts', label: 'Pro Sheet signals', desc: 'New setup, intraday BUY / SELL, opening-range break' },
  { key: 'nsestocks.lensAlerts', label: 'Lens screens', desc: 'A stock newly matches the screen open in Lens' },
];
const EVENT = 'nsestocks:alerts';

export function readPref(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function setPref(key, on) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* not remembered across reloads */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, on } }));
  // ask for system notifications without holding the switch until the prompt is answered
  if (on && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// Current value of one switch, kept in sync with the panel and with other tabs.
export function useAlertPref(key) {
  const [on, setOn] = useState(() => readPref(key));
  useEffect(() => {
    const sync = () => setOn(readPref(key));
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [key]);
  return on;
}
