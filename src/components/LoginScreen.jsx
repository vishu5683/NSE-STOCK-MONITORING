import React, { useState } from 'react';
import { login, lockedFor } from '../lib/auth.js';

export default function LoginScreen({ name, tagline, onDone }) {
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
    <div className="boot">
      <form className="card login" onSubmit={submit}>
        <div className="lock">🔒</div>
        <h2>{name || 'Sign in'}</h2>
        <p className="muted small">{tagline || 'Sign in to continue.'}</p>
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
