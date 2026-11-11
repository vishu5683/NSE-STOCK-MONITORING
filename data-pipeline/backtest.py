"""
Backtest of the daily setup rules (same rules and score as src/lib/signals.js, settings from public/config.json).

For every past session in the last ~year where a stock was a BULL or BEAR setup:
  entry = that day's close, stop = entry -/+ ATR x atrMult, target 1 = entry +/- risk x rr1.
  Over the next HOLD sessions: target first = win, stop first = loss (a day touching both counts as a loss),
  neither = open (closed at the last close, counted by its R multiple).
One signal per stock per side is counted again only after the previous one is finished.
Research numbers, not a promise: no costs, no slippage, daily bars only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HOLD = 10
LOOKBACK = 250


def _wilder(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def _indicators(df: pd.DataFrame) -> pd.DataFrame:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    out = pd.DataFrame(index=df.index)
    out["c"], out["h"], out["l"] = c, h, l
    out["ema20"] = c.ewm(span=20, adjust=False).mean()
    out["ema50"] = c.ewm(span=50, adjust=False).mean()
    out["ema200"] = c.ewm(span=200, adjust=False).mean()
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    out["macd"], out["sig"] = macd, macd.ewm(span=9, adjust=False).mean()
    d = c.diff()
    up, dn = _wilder(d.clip(lower=0), 14), _wilder((-d).clip(lower=0), 14)
    out["rsi"] = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    pc = c.shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    atr = _wilder(tr, 14)
    out["atr"] = atr
    upm, dnm = h.diff(), -l.diff()
    plus = pd.Series(np.where((upm > dnm) & (upm > 0), upm, 0.0), index=df.index)
    minus = pd.Series(np.where((dnm > upm) & (dnm > 0), dnm, 0.0), index=df.index)
    pdi, mdi = 100 * _wilder(plus, 14) / atr, 100 * _wilder(minus, 14) / atr
    out["adx"] = _wilder(100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan), 14)
    out["vspike"] = v / v.shift(1).rolling(20, min_periods=10).mean()
    out["distHi"] = (c / h.rolling(252, min_periods=60).max() - 1) * 100
    out["distLo"] = (c / l.rolling(252, min_periods=60).min() - 1) * 100
    return out


def _scores(x: pd.DataFrame, cfg: dict) -> tuple[pd.Series, pd.Series]:
    """Vectorised copy of bullScore / bearScore in signals.js."""
    adx_pts = np.clip(12 + (x["adx"] - cfg["adx"]) / 2, 12, 20).where(x["adx"] >= cfg["adx"], 0)
    vol_pts = np.where(x["vspike"] >= cfg["volSpike"], 15, np.where(x["vspike"] >= 1, 8, 0))

    bull = (
        (x["c"] > x["ema20"]) * 8 + (x["ema20"] > x["ema50"]) * 9 + (x["c"] > x["ema200"]) * 8
        + np.where((x["rsi"] >= cfg["bullRsi"]) & (x["rsi"] <= 75), 20, np.where(x["rsi"] > 75, 12, np.where(x["rsi"] >= 50, 8, 0)))
        + adx_pts + vol_pts
        + np.where(x["distHi"] >= -2, 10, np.where(x["distHi"] >= -5, 5, 0))
        + np.where(x["macd"] > x["sig"], np.where(x["macd"] > 0, 10, 5), 0)
    ).clip(0, 100)
    bear = (
        (x["c"] < x["ema20"]) * 8 + (x["ema20"] < x["ema50"]) * 9 + (x["c"] < x["ema200"]) * 8
        + np.where((x["rsi"] <= cfg["bearRsi"]) & (x["rsi"] >= 25), 20, np.where(x["rsi"] < 25, 12, np.where(x["rsi"] <= 50, 8, 0)))
        + adx_pts + vol_pts
        + np.where(x["distLo"] <= 2, 10, np.where(x["distLo"] <= 5, 5, 0))
        + np.where(x["macd"] < x["sig"], np.where(x["macd"] < 0, 10, 5), 0)
    ).clip(0, 100)
    return bull.round(), bear.round()


def _side(x: pd.DataFrame, cfg: dict) -> pd.Series:
    bull, bear = _scores(x, cfg)
    vol_ok = x["vspike"] >= cfg["volSpike"]
    req = vol_ok if cfg.get("requireVolume") else True
    bull_ok = (bull >= cfg["minScore"]) & (x["rsi"] >= cfg["bullRsi"]) & (x["adx"] >= cfg["adx"]) & (x["c"] > x["ema20"]) & (x["ema20"] > x["ema50"]) & req
    bear_ok = (bear >= cfg["minScore"]) & (x["rsi"] <= cfg["bearRsi"]) & (x["adx"] >= cfg["adx"]) & (x["c"] < x["ema20"]) & (x["ema20"] < x["ema50"]) & req
    side = pd.Series(0, index=x.index)
    side[bull_ok & (~bear_ok | (bull >= bear))] = 1
    side[(side == 0) & bear_ok] = -1
    return side


def backtest_stock(df: pd.DataFrame, cfg: dict) -> list[dict]:
    if len(df) < 300:
        return []
    x = _indicators(df)
    side = _side(x, cfg)
    c, h, l, atr = x["c"].values, x["h"].values, x["l"].values, x["atr"].values
    n = len(x)
    start = max(0, n - LOOKBACK - HOLD)
    trades = []
    busy = {1: -1, -1: -1}  # index until which a side is in a trade
    for i in range(start, n - 1):
        s = int(side.iloc[i])
        if s == 0 or i <= busy[s] or not np.isfinite(atr[i]) or atr[i] <= 0:
            continue
        risk = atr[i] * cfg["atrMult"]
        entry = c[i]
        stop, t1 = entry - s * risk, entry + s * risk * cfg["rr1"]
        result, r_mult, end = "open", None, min(n - 1, i + HOLD)
        for j in range(i + 1, end + 1):
            hit_stop = l[j] <= stop if s == 1 else h[j] >= stop
            hit_t1 = h[j] >= t1 if s == 1 else l[j] <= t1
            if hit_stop:
                result, r_mult, end = "loss", -1.0, j
                break
            if hit_t1:
                result, r_mult, end = "win", cfg["rr1"], j
                break
        if result == "open":
            if end - i < HOLD:  # too recent to judge
                continue
            r_mult = s * (c[end] - entry) / risk
        busy[s] = end
        trades.append({"side": s, "result": result, "r": float(r_mult), "date": x.index[i].strftime("%Y-%m-%d")})
    return trades


def summarise(trades: list[dict]) -> dict:
    n = len(trades)
    if not n:
        return {"n": 0}
    win = sum(t["result"] == "win" for t in trades)
    loss = sum(t["result"] == "loss" for t in trades)
    return {
        "n": n,
        "win": win,
        "loss": loss,
        "open": n - win - loss,
        "winPct": round(win / n * 100, 1),
        "avgR": round(sum(t["r"] for t in trades) / n, 2),
    }


def run_backtest(frames: dict, symbols: list[str], cfg: dict, ticker) -> tuple[dict, dict]:
    """Returns (meta block, per-symbol summary)."""
    every, per = [], {}
    for sym in symbols:
        df = frames.get(ticker(sym))
        if df is None:
            continue
        t = backtest_stock(df, cfg)
        if t:
            per[sym] = summarise(t)
            every.extend(t)
    dates = sorted(t["date"] for t in every)
    meta = {
        "rules": {k: cfg[k] for k in ("minScore", "volSpike", "bullRsi", "bearRsi", "adx", "atrMult", "rr1")},
        "holdDays": HOLD,
        "from": dates[0] if dates else None,
        "to": dates[-1] if dates else None,
        "all": summarise(every),
        "bull": summarise([t for t in every if t["side"] == 1]),
        "bear": summarise([t for t in every if t["side"] == -1]),
    }
    return meta, per
