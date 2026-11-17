"""
Daily accuracy check: our daily candle for every stock (Yahoo) against NSE's official end-of-day
file (sec_bhavdata_full) for the same session. Writes the result into latest.json meta.recon;
the evening health message (/api/lens?daily=health) reports it to the owner.

Never fails the workflow: a missing NSE file (posted in the evening) is reported as "pending".
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
from datetime import date
from pathlib import Path

from nse_extras import BASE, _get, _num

OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "latest.json"
PRICE_TOL = 0.0005  # 0.05 %
VOLUME_TOL = 0.01   # 1 %
FIELDS = (("ltp", "close", PRICE_TOL), ("open", "open", PRICE_TOL), ("high", "high", PRICE_TOL),
          ("low", "low", PRICE_TOL), ("volume", "volume", VOLUME_TOL))


def nse_bhav(d: date) -> dict:
    raw = _get(f"{BASE}/products/content/sec_bhavdata_full_{d.strftime('%d%m%Y')}.csv")
    if not raw:
        return {}
    out = {}
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))):
        r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
        if r.get("SERIES") not in ("EQ", "BE"):
            continue
        out[r["SYMBOL"]] = {
            "open": _num(r.get("OPEN_PRICE")), "high": _num(r.get("HIGH_PRICE")), "low": _num(r.get("LOW_PRICE")),
            "close": _num(r.get("CLOSE_PRICE")), "volume": _num(r.get("TTL_TRD_QNTY")),
        }
    return out


def compare(stocks: list, bhav: dict, day: str) -> dict:
    checked, missing, items = 0, [], []
    for s in stocks:
        if s.get("asOf") != day:
            continue
        n = bhav.get(s["s"])
        if not n:
            missing.append(s["s"])
            continue
        checked += 1
        for ours_key, nse_key, tol in FIELDS:
            a, b = s.get(ours_key), n.get(nse_key)
            if a is None or b is None or b == 0:
                continue
            if abs(a / b - 1) > tol:
                items.append({"s": s["s"], "field": nse_key, "ours": a, "nse": b, "diffPct": round((a / b - 1) * 100, 2)})
    bad = sorted({i["s"] for i in items})
    return {"date": day, "status": "ok" if not bad else "mismatch", "checked": checked, "mismatched": len(bad),
            "missing": missing[:20], "items": sorted(items, key=lambda i: -abs(i["diffPct"]))[:15]}


def main() -> int:
    if not OUT.exists():
        print("reconcile: no latest.json", file=sys.stderr)
        return 0
    data = json.loads(OUT.read_text(encoding="utf-8"))
    meta = data.get("meta", {})
    day = meta.get("lastTradingDate")
    if meta.get("barForming") or not day:
        meta["recon"] = {"date": day, "status": "pending", "note": "session still open"}
    else:
        bhav = nse_bhav(date.fromisoformat(day))
        meta["recon"] = compare(data.get("stocks", []), bhav, day) if bhav else {"date": day, "status": "pending", "note": "NSE file not posted yet"}
    data["meta"] = meta
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    os.replace(tmp, OUT)
    r = meta["recon"]
    print(f"reconcile {r.get('date')}: {r.get('status')} checked={r.get('checked')} mismatched={r.get('mismatched')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
