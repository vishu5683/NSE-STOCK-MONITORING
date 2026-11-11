"""
NSE Stocks data pipeline (free, no API key).

Reads universe.csv, downloads daily candles from Yahoo Finance (NSE tickers end with .NS),
computes indicators (RSI, EMA 20/50/200, MACD, ADX, ATR, volume spike, 52-week range, intraday VWAP) and writes
public/data/latest.json for the website.

Honest limits (also shown in the app):
  * Yahoo data for NSE is delayed (about 15 minutes) and unofficial. Fine for a screener,
    not for order execution.
  * Intraday VWAP / EMA 9/15 / CPR come from 5-minute candles (intraday.py). There is no free
    reliable option chain, OI or futures feed, so those are NOT faked.

If too many symbols fail, the script exits with an error and leaves the old file untouched.
"""
from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "data" / "latest.json"
IST = timezone(timedelta(hours=5, minutes=30))

INDICES = [
    ("NIFTY 50", "^NSEI"),
    ("BANK NIFTY", "^NSEBANK"),
    ("SENSEX", "^BSESN"),
    ("INDIA VIX", "^INDIAVIX"),
]

CHUNK = 40
MIN_BARS = 60
MIN_OK_RATIO = 0.7


def yahoo_symbol(sym: str) -> str:
    return f"{sym}.NS"


def wilder(series: pd.Series, n: int) -> pd.Series:
    return series.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = wilder(d.clip(lower=0), n)
    dn = wilder((-d).clip(lower=0), n)
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def atr(h: pd.Series, l: pd.Series, c: pd.Series, n: int = 14) -> pd.Series:
    pc = c.shift(1)
    tr = pd.concat([h - l, (h - pc).abs(), (l - pc).abs()], axis=1).max(axis=1)
    return wilder(tr, n)


def adx(h: pd.Series, l: pd.Series, c: pd.Series, n: int = 14) -> pd.Series:
    up = h.diff()
    dn = -l.diff()
    plus = pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=h.index)
    minus = pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=h.index)
    a = atr(h, l, c, n)
    pdi = 100 * wilder(plus, n) / a
    mdi = 100 * wilder(minus, n) / a
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return wilder(dx, n)


def num(x, nd=2):
    if x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, nd)


def market_state(now_ist: datetime, last_bar_date) -> tuple[str, bool]:
    """Returns (phase text, last bar is still forming)."""
    wd = now_ist.weekday()
    minutes = now_ist.hour * 60 + now_ist.minute
    is_trading_day = wd < 5
    if is_trading_day and 9 * 60 + 15 <= minutes < 15 * 60 + 40:
        if last_bar_date == now_ist.date():
            return "MARKET OPEN (delayed)", True
        # weekday session hours but no candle for today: exchange holiday or the feed is late
        return "NO SESSION TODAY - holiday or feed delay (last close shown)", False
    if is_trading_day and minutes < 9 * 60 + 15:
        return "PRE-OPEN (last close shown)", False
    return "MARKET CLOSED (last close shown)", False


def download(symbols: list[str]) -> dict[str, pd.DataFrame]:
    frames: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), CHUNK):
        chunk = symbols[i : i + CHUNK]
        for attempt in range(3):
            try:
                raw = yf.download(
                    chunk,
                    period="2y",
                    interval="1d",
                    auto_adjust=False,
                    progress=False,
                    group_by="ticker",
                    threads=False,
                )
                break
            except Exception as exc:  # network hiccup
                print(f"  chunk {i // CHUNK + 1} attempt {attempt + 1} failed: {exc}")
                time.sleep(3 * (attempt + 1))
                raw = None
        if raw is None or raw.empty:
            continue
        for t in chunk:
            try:
                df = raw[t] if len(chunk) > 1 else raw
                df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
                if len(df) >= 2:
                    frames[t] = df
            except KeyError:
                continue
        print(f"  downloaded {min(i + CHUNK, len(symbols))}/{len(symbols)}")
    return frames


def build_row(df: pd.DataFrame, forming: bool) -> dict | None:
    if len(df) < MIN_BARS:
        return None
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    ema20 = c.ewm(span=20, adjust=False).mean()
    ema50 = c.ewm(span=50, adjust=False).mean()
    ema200 = c.ewm(span=200, adjust=False).mean() if len(c) >= 150 else pd.Series(np.nan, index=c.index)
    macd_line = c.ewm(span=12, adjust=False).mean() - c.ewm(span=26, adjust=False).mean()
    macd_sig = macd_line.ewm(span=9, adjust=False).mean()
    r = rsi(c)
    a = atr(h, l, c)
    ad = adx(h, l, c)

    last = c.iloc[-1]
    prev = c.iloc[-2]
    # a still-forming bar has partial volume, so compare the last COMPLETE session instead
    vol_idx = -2 if forming else -1
    vol_today = float(v.iloc[vol_idx])
    base = v.iloc[vol_idx - 20 : vol_idx]
    avg_vol = float(base.mean()) if len(base) >= 10 else float("nan")
    vol_spike = vol_today / avg_vol if avg_vol and avg_vol > 0 else None

    window = df.tail(252)
    hi52 = float(window["High"].max())
    lo52 = float(window["Low"].min())

    def pct(n):
        return (last / c.iloc[-1 - n] - 1) * 100 if len(c) > n else None

    e20, e50, e200 = ema20.iloc[-1], ema50.iloc[-1], ema200.iloc[-1]
    if last > e20 > e50:
        trend = "UPTREND"
    elif last < e20 < e50:
        trend = "DOWNTREND"
    else:
        trend = "SIDEWAYS"

    vi = -2 if forming else -1
    # daily patterns on the last COMPLETE session
    hc, lc = h.iloc[: len(h) + vi + 1], l.iloc[: len(l) + vi + 1]
    rng = hc - lc
    cc = c.iloc[: len(c) + vi + 1]
    nr7 = bool(len(rng) >= 7 and rng.iloc[-1] <= rng.tail(7).min())
    inside = bool(len(hc) >= 2 and hc.iloc[-1] <= hc.iloc[-2] and lc.iloc[-1] >= lc.iloc[-2])
    hi20 = float(hc.iloc[-21:-1].max()) if len(hc) > 21 else None
    lo20 = float(lc.iloc[-21:-1].min()) if len(lc) > 21 else None
    streak = 0
    diffs = cc.diff().tail(10).tolist()[::-1]
    for dlt in diffs:
        if dlt > 0 and streak >= 0:
            streak += 1
        elif dlt < 0 and streak <= 0:
            streak -= 1
        else:
            break
    return {
        "nr7": nr7,
        "insideBar": inside,
        "hi20": num(hi20),
        "lo20": num(lo20),
        "streak": streak,
        "open": num(df["Open"].iloc[-1]),
        "high": num(h.iloc[-1]),
        "low": num(l.iloc[-1]),
        "prevClose": num(prev),
        "valueCr": num(float(c.iloc[vi]) * float(v.iloc[vi]) / 1e7),
        "ltp": num(last),
        "chg": num((last / prev - 1) * 100),
        "chg1w": num(pct(5)),
        "chg1m": num(pct(21)),
        "volume": int(vol_today),
        "avgVol20": int(avg_vol) if avg_vol == avg_vol else None,
        "volSpike": num(vol_spike),
        "hi52": num(hi52),
        "lo52": num(lo52),
        "distHi": num((last / hi52 - 1) * 100),
        "distLo": num((last / lo52 - 1) * 100),
        "ema20": num(e20),
        "ema50": num(e50),
        "ema200": num(e200),
        "rsi": num(r.iloc[-1], 1),
        "macd": num(macd_line.iloc[-1], 3),
        "macdSig": num(macd_sig.iloc[-1], 3),
        "adx": num(ad.iloc[-1], 1),
        "atr": num(a.iloc[-1]),
        "trend": trend,
        "asOf": df.index[-1].strftime("%Y-%m-%d"),
        "spark": [num(x) for x in c.tail(60).tolist()],
    }


def main() -> int:
    # keep yfinance's cache out of the repo and avoid 'database is locked'
    cache = Path(tempfile.gettempdir()) / "nsestocks-yf-cache"
    cache.mkdir(exist_ok=True)
    try:
        yf.set_tz_cache_location(str(cache))
    except Exception:
        pass

    uni = pd.read_csv(HERE / "universe.csv")
    uni["symbol"] = uni["symbol"].str.strip()
    lots = {}
    lot_file = HERE / "lot_sizes.csv"
    if lot_file.exists():
        lots = {r.symbol: int(r.lot) for r in pd.read_csv(lot_file).itertuples()}
    now = datetime.now(IST)

    print(f"Downloading {len(uni)} stocks + {len(INDICES)} indices ...")
    frames = download([yahoo_symbol(s) for s in uni["symbol"]] + [i[1] for i in INDICES])

    ok_rows, failed = [], []
    last_dates = []
    for _, row in uni.iterrows():
        df = frames.get(yahoo_symbol(row["symbol"]))
        if df is None or len(df) < MIN_BARS:
            failed.append(row["symbol"])
            continue
        last_dates.append(df.index[-1].date())
        ok_rows.append((row, df))

    if len(ok_rows) < MIN_OK_RATIO * len(uni):
        print(f"ERROR: only {len(ok_rows)}/{len(uni)} symbols loaded. Keeping the previous file.")
        return 1

    ref_date = max(last_dates)
    phase, forming = market_state(now, ref_date)

    stocks = []
    for row, df in ok_rows:
        built = build_row(df, forming and df.index[-1].date() == now.date())
        if not built:
            failed.append(row["symbol"])
            continue
        # drop a stale symbol (halted / suspended): last bar older than 7 days
        if (ref_date - df.index[-1].date()).days > 7:
            failed.append(row["symbol"])
            continue
        stocks.append({"s": row["symbol"], "sec": row["sector"], "lot": lots.get(row["symbol"]), **built})

    # ---- intraday layer (VWAP, EMA 9/15, CPR, ATM). Optional: a failure here never blocks the daily data ----
    intraday_ok = 0
    iframes = {}
    try:
        from intraday import build_intraday, download_intraday

        print("Downloading 5-minute candles ...")
        iframes = download_intraday([yahoo_symbol(s["s"]) for s in stocks] + [i[1] for i in INDICES])
        for s in stocks:
            ib = build_intraday(iframes.get(yahoo_symbol(s["s"])), frames.get(yahoo_symbol(s["s"])))
            if ib:
                s.update(ib)
                intraday_ok += 1
    except Exception as exc:  # keep the daily file even if intraday breaks
        print(f"WARN: intraday layer skipped: {exc}")

    # ---- F&O layer from the NSE end-of-day bhavcopy (futures OI, PCR, max pain, IV, official lot) ----
    fo_date = None
    fo_count = 0
    chains = {}
    fo = None
    try:
        from derivatives import build_derivatives

        print("Downloading NSE F&O bhavcopy ...")
        fo = build_derivatives(now.date())
    except Exception as exc:
        print(f"WARN: F&O layer skipped: {exc}")
    if fo:
        fo_date = fo["date"]
        chains = fo["chains"]
        for s in stocks:
            d = fo["stocks"].get(s["s"])
            if fo["names"].get(s["s"]):
                s["name"] = fo["names"][s["s"]]
            if d:
                lot_csv = s.get("lot")
                s.update(d)
                if not d.get("lot"):
                    s["lot"] = lot_csv
                fo_count += 1

    # ---- more NSE public files: ban list, MWPL %, delivery %, participant OI ----
    extras = {}
    try:
        from nse_extras import build_extras

        print("Downloading NSE ban list, MWPL, delivery, participant OI ...")
        extras = build_extras(date.fromisoformat(fo_date) if fo_date else now.date())
    except Exception as exc:
        print(f"WARN: NSE extras skipped: {exc}")
    ban = set(extras.get("ban") or [])
    deliv_n = 0
    for s in stocks:
        if extras.get("mwpl", {}).get(s["s"]):
            s.update(extras["mwpl"][s["s"]])
        if extras.get("delivery", {}).get(s["s"]):
            s.update(extras["delivery"][s["s"]])
            deliv_n += 1
        if s["s"] in ban:
            s["inBan"] = True

    indices = []
    for name, ysym in INDICES:
        df = frames.get(ysym)
        if df is None or len(df) < MIN_BARS:
            continue
        b = build_row(df, False)
        if b:
            try:
                ib = build_intraday(iframes.get(ysym), df)
                if ib:
                    b.update(ib)
            except Exception:
                pass
            if fo and fo["indices"].get(name):
                b.update(fo["indices"][name])
            indices.append({"name": name, "symbol": ysym, **b})

    # ---- health checks: catch the "everything is 0.00%" kind of broken feed before publishing ----
    zero = sum(1 for s in stocks if s["chg"] == 0)
    zero_ratio = zero / max(1, len(stocks))
    age_days = (now.date() - ref_date).days
    with_vol = sum(1 for s in stocks if s["volSpike"] is not None)
    health = [
        {"name": "Symbols loaded", "ok": len(stocks) >= 0.95 * len(uni), "detail": f"{len(stocks)} of {len(uni)}"},
        {"name": "Prices are moving", "ok": zero_ratio < 0.2, "detail": f"{zero} stocks show 0.00% change"},
        {"name": "Data date is recent", "ok": age_days <= 4, "detail": f"last session {ref_date.isoformat()}, {age_days} day(s) ago"},
        {"name": "Indices loaded", "ok": len(indices) >= 3, "detail": f"{len(indices)} of {len(INDICES)}"},
        {"name": "Volume data present", "ok": with_vol >= 0.9 * len(stocks), "detail": f"{with_vol} of {len(stocks)}"},
        {"name": "F&O data (NSE bhavcopy)", "ok": fo_count >= 150, "detail": f"{fo_count} stocks, session {fo_date or 'not found'}"},
        {"name": "Delivery % (NSE)", "ok": deliv_n >= 0.8 * len(stocks), "detail": f"{deliv_n} of {len(stocks)}"},
        {"name": "Intraday (5-min) data", "ok": intraday_ok >= 0.8 * len(stocks), "detail": f"{intraday_ok} of {len(stocks)}"},
    ]
    if zero_ratio > 0.5:
        print(f"ERROR: {zero}/{len(stocks)} stocks have 0.00% change. Feed looks broken. Keeping the previous file.")
        return 1

    payload = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "generatedAtIST": now.strftime("%d-%b-%Y %I:%M %p IST"),
            "marketPhase": phase,
            "lastTradingDate": ref_date.isoformat(),
            "foDate": fo_date,
            "banDate": extras.get("banDate"),
            "ban": sorted(ban),
            "participants": extras.get("participants"),
            "barForming": bool(forming),
            "source": "Yahoo Finance (delayed ~15 min, unofficial) - daily candles",
            "universe": int(len(uni)),
            "loaded": len(stocks),
            "failed": sorted(set(failed)),
            "health": health,
            "notes": [
                "Volume spike compares the last completed session with its 20-day average.",
                "Intraday VWAP, EMA 9/15 and CPR come from Yahoo 5-minute candles.",
                f"Futures OI, option chain, PCR, max pain, IV and lot sizes come from the NSE F&O bhavcopy of {fo_date or 'n/a'} (end of day, not live).",
                "Lot sizes: NSE bhavcopy when available, else lot_sizes.csv (client sheet of 8-Nov-2026).",
                "Screener output is rule-based research, not investment advice.",
            ],
        },
        "indices": indices,
        "stocks": stocks,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    os.replace(tmp, OUT)
    if chains:
        chain_out = OUT.parent / "chain.json"
        ctmp = chain_out.with_suffix(".tmp")
        ctmp.write_text(json.dumps({"date": fo_date, "chains": chains}, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        os.replace(ctmp, chain_out)
    for h in health:
        print(f"  [{'ok' if h['ok'] else 'WARN'}] {h['name']}: {h['detail']}")
    print(f"OK: {len(stocks)} stocks, {len(indices)} indices, {len(set(failed))} failed -> {OUT}")
    if failed:
        print("Failed:", ", ".join(sorted(set(failed))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
