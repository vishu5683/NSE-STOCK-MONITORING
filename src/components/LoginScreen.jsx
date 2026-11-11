import React, { useState } from 'react';
import { login, grant, lockedFor } from '../lib/auth.js';
import { serverLogin } from '../lib/liveApi.js';

export default function LoginScreen({ name, tagline, onDone }) {
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = lockedFor() > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    // With the live backend the server checks the password (real security). Without it, the local check is used.
    const server = await serverLogin(pw);
    setBusy(false);
    if (server.status === 'ok') {
      grant();
      onDone();
      return;
    }
    if (server.status === 'wrong' || server.status === 'locked' || server.status === 'error') {
      setMsg(server.message || 'Wrong password.');
      setPw('');
      return;
    }
    const res = login(pw);
    if (res.ok) onDone();
    else {
      setMsg(res.message);
      setPw('');
    }
  };

  return (
    <div className="signin">
      <div className="signin-glow" aria-hidden="true" />
      <form className="signin-card" onSubmit={submit}>
        <div className="signin-logo">
          <svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="14" fill="var(--accent)" />
            <path d="M10 44 24 28l9 8 21-20" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M42 16h12v12" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1>{name || 'Sign in'}</h1>
        <p className="muted">{tagline || 'Sign in to continue'}</p>

        <label className="signin-field">
          <span>Password</span>
          <div className="signin-input">
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value);
                setMsg('');
              }}
              autoFocus
              autoComplete="current-password"
              placeholder="Enter password"
              disabled={locked}
              aria-invalid={!!msg}
            />
            <button type="button" className="signin-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        {msg && (
          <p className="signin-error" role="alert">
            {msg}
          </p>
        )}
        <button className="btn primary block signin-btn" type="submit" disabled={!pw || locked || busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="signin-foot">NSE F&amp;O screener · delayed data · not investment advice</p>
      </form>
    </div>
  );
}
