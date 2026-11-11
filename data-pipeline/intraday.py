"""
Intraday layer (5-minute candles from Yahoo) for the Intraday Scanner.

Per stock and index: today's VWAP, EMA 9/15, RSI 14, MACD and CPR (from the previous session).
The signal, CPR zone and ATM strike are worked out in the browser (src/lib/intraday.js) against
the live price. Everything comes from real candles; a symbol with too few candles is skipped,
never filled with made-up numbers.
"""
from __future__ import annotations

import math
import time

import numpy as np
import pandas as pd
import yfinance as yf

CHUNK = 40
MIN_BARS = 20  # 5-min bars needed for EMA 15 / RSI 14 to mean something


def _rsi(close: pd.Series, n: int = 14) -> float | None:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d).clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    if dn.iloc[-1] == 0 or math.isnan(dn.iloc[-1]):
        return None
    return float(100 - 100 / (1 + up.iloc[-1] / dn.iloc[-1]))


def cpr(prev_high: float, prev_low: float, prev_close: float) -> dict:
    pivot = (prev_high + prev_low + prev_close) / 3
    bc = (prev_high + prev_low) / 2
    tc = 2 * pivot - bc
    lo, hi = min(bc, tc), max(bc, tc)
    width_pct = (hi - lo) / pivot * 100 if pivot else None
    return {"pivot": pivot, "bc": lo, "tc": hi, "widthPct": width_pct}


def build_intraday(df: pd.DataFrame, daily: pd.DataFrame | None) -> dict | None:
    """df: 5-minute OHLCV (tz-aware index). daily: daily OHLC used for yesterday's CPR."""
    if df is None or df.empty:
        return None
    df = df.dropna(subset=["Close"])
    if len(df) < MIN_BARS:
        return None
    last_day = df.index[-1].date()
    today = df[df.index.date == last_day]
    if today.empty:
        return None

    typical = (today["High"] + today["Low"] + today["Close"]) / 3
    vol = today["Volume"].astype(float)
    # indices report no volume on Yahoo: fall back to the plain average of the typical price, flagged
    proxy = not vol.sum() > 0
    vwap = float(typical.mean()) if proxy else float((typical * vol).sum() / vol.sum())

    c = df["Close"]
    ema9 = float(c.ewm(span=9, adjust=False).mean().iloc[-1])
    ema15 = float(c.ewm(span=15, adjust=False).mean().iloc[-1])
    macd = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    macd_sig = macd.ewm(span=9, adjust=False).mean()
    ltp = float(c.iloc[-1])

    out = {
        "iLtp": round(ltp, 2),
        "vwap": round(vwap, 2),
        "ema9i": round(ema9, 2),
        "ema15i": round(ema15, 2),
        "rsiI": None,
        "macdI": round(float(macd.iloc[-1]), 3),
        "macdIsig": round(float(macd_sig.iloc[-1]), 3),
        "iBars": int(len(today)),
        "iAsOf": df.index[-1].strftime("%Y-%m-%d %H:%M"),
    }
    if proxy:
        out["vwapProxy"] = True
    r = _rsi(c)
    out["rsiI"] = round(r, 1) if r is not None else None

    # CPR from the last completed daily session before today's bar
    if daily is not None and len(daily) >= 2:
        d = daily[daily.index.date < last_day]
        if len(d):
            p = d.iloc[-1]
            z = cpr(float(p["High"]), float(p["Low"]), float(p["Close"]))
            out["cprBc"] = round(z["bc"], 2)
            out["cprTc"] = round(z["tc"], 2)
            out["cprPivot"] = round(z["pivot"], 2)
            out["cprWidthPct"] = round(z["widthPct"], 2) if z["widthPct"] is not None else None
    return out


def download_intraday(yahoo_symbols: list[str]) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    for i in range(0, len(yahoo_symbols), CHUNK):
        chunk = yahoo_symbols[i : i + CHUNK]
        raw = None
        for attempt in range(3):
            try:
                raw = yf.download(
                    chunk, period="5d", interval="5m", auto_adjust=False,
                    progress=False, group_by="ticker", threads=False,
                )
                break
            except Exception as exc:
                print(f"  intraday chunk {i // CHUNK + 1} attempt {attempt + 1} failed: {exc}")
                time.sleep(3 * (attempt + 1))
        if raw is None or raw.empty:
            continue
        for t in chunk:
            try:
                df = raw[t] if len(chunk) > 1 else raw
                df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
                if len(df):
                    frames[t] = df
            except KeyError:
                continue
        print(f"  intraday {min(i + CHUNK, len(yahoo_symbols))}/{len(yahoo_symbols)}")
    return frames
