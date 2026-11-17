"""
Fundamentals for the Lens screener (free, no API key).

Reads universe.csv and pulls per-stock fundamental ratios from Yahoo Finance's quote-summary
(yfinance `.info`): market cap, P/E, P/B, debt-to-equity, return on assets, net profit, and
Yahoo's own sector/industry (finer-grained than universe.csv's one sector column, closer to the
client's "Sector / Sub Sector" pair).

Honest limits (also shown in the app, see Lens.jsx):
  * No free, bulk, official source for NSE promoter shareholding exists (it is filed quarterly as
    PDF/XBRL, not a clean API). `promoterPct` is Yahoo's `heldPercentInsiders`, a rough proxy that
    is frequently missing or stale for Indian stocks -- NOT the real promoter-holding percentage.
    It is labelled "Insider holding (proxy)" in the UI, never "Promoter Holding".
  * `.info` is one HTTP call per symbol (unlike the batched chart/spark endpoints the rest of the
    pipeline uses) and Yahoo throttles/blocks bulk callers more aggressively on this endpoint. A
    short delay between calls and a generous per-symbol timeout are used; a failed symbol is
    skipped (old value, if any, is kept) rather than failing the whole run.
  * Fundamentals move slowly (quarterly results, standing ratios) -- this is meant to run once a
    day, not on every intraday refresh.
"""
from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "public" / "data" / "fundamentals.json"
IST = timezone(timedelta(hours=5, minutes=30))

FIELDS = {
    "marketCap": "marketCap",
    "trailingPE": "pe",
    "priceToBook": "pb",
    "debtToEquity": "debtToEquity",
    "returnOnAssets": "roa",
    "heldPercentInsiders": "promoterPct",
    "netIncomeToCommon": "netProfit",
    "sector": "sector",
    "industry": "subSector",
}

CR = 1e7  # 1 crore


def one(symbol: str) -> dict | None:
    try:
        info = yf.Ticker(f"{symbol}.NS").get_info()
    except Exception:
        return None
    if not info or not info.get("regularMarketPrice") and not info.get("currentPrice"):
        return None
    out = {}
    for src, dst in FIELDS.items():
        v = info.get(src)
        if v is None:
            continue
        if dst in ("marketCap", "netProfit"):
            v = round(v / CR, 2)  # rupees -> Cr
        elif dst in ("roa", "promoterPct"):
            v = round(v * 100, 2)  # fraction -> %
        elif isinstance(v, float):
            v = round(v, 2)
        out[dst] = v
    return out or None


def main() -> int:
    uni = pd.read_csv(HERE / "universe.csv")
    symbols = uni["symbol"].tolist()

    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8")).get("stocks", {})
        except Exception:
            old = {}

    stocks = dict(old)
    ok, failed = 0, []
    for i, sym in enumerate(symbols):
        row = one(sym)
        if row:
            stocks[sym] = row
            ok += 1
        else:
            failed.append(sym)
        if i % 25 == 0:
            print(f"fundamentals: {i}/{len(symbols)} ({ok} ok, {len(failed)} failed so far)", flush=True)
        time.sleep(0.35)  # be polite to an endpoint that is not meant for bulk use

    if ok < len(symbols) * 0.5:
        print(f"fundamentals: only {ok}/{len(symbols)} symbols loaded, keeping the previous file", file=sys.stderr)
        return 1 if not old else 0  # a thin first run still exits 0 so it does not block the data refresh

    payload = {
        "asOf": datetime.now(IST).isoformat(),
        "ok": ok,
        "failed": len(failed),
        "stocks": stocks,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"fundamentals: wrote {ok} stocks ({len(failed)} failed: {', '.join(failed[:20])}{'...' if len(failed) > 20 else ''})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
