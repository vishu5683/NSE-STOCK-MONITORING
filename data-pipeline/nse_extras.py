"""
More free NSE public archive files (no login, no scraping), all end of day:

  * F&O ban list for the next session     content/fo/fo_secban.csv
  * MWPL usage per stock (ban risk)        archives/nsccl/mwpl/combineoi_DDMMYYYY.zip
  * Delivery % per stock                   products/content/sec_bhavdata_full_DDMMYYYY.csv
  * Participant-wise OI (FII/DII/Pro/Client long-short), with the change vs the session before
                                           content/nsccl/fao_participant_oi_DDMMYYYY.csv

Every block is optional: a missing file leaves that block empty, never guessed.
"""
from __future__ import annotations

import csv
import io
import re
import urllib.request
import zipfile
from datetime import date, timedelta

UA = {"User-Agent": "nsestocks-pro-data/1.0"}
BASE = "https://nsearchives.nseindia.com"


def _get(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            data = r.read()
        # the archive host answers a missing file with an HTML page
        return None if data[:20].lstrip().lower().startswith(b"<!doctype") else data
    except Exception:
        return None


def _num(x):
    try:
        return float(str(x).strip().replace(",", ""))
    except ValueError:
        return None


def ban_list() -> tuple[str | None, list[str]]:
    raw = _get(f"{BASE}/content/fo/fo_secban.csv")
    if not raw:
        return None, []
    lines = raw.decode("utf-8", "replace").splitlines()
    m = re.search(r"(\d{2}-[A-Z]{3}-\d{4})", lines[0].upper()) if lines else None
    syms = [ln.split(",")[1].strip() for ln in lines[1:] if ln.count(",") >= 1 and ln.split(",")[1].strip()]
    return (m.group(1) if m else None), syms


def mwpl(d: date) -> dict[str, dict]:
    raw = _get(f"{BASE}/archives/nsccl/mwpl/combineoi_{d.strftime('%d%m%Y')}.zip")
    if not raw:
        return {}
    z = zipfile.ZipFile(io.BytesIO(raw))
    name = next((n for n in z.namelist() if n.endswith(".csv")), None)
    if not name:
        return {}
    out = {}
    for r in csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8")):
        r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
        limit, foi = _num(r.get("MWPL")), _num(r.get("Future Equivalent Open Interest"))
        sym = r.get("NSE Symbol")
        if sym and limit and foi is not None:
            out[sym] = {"mwplPct": round(foi / limit * 100, 1), "noFresh": r.get("Limit for Next Day", "").lower().startswith("no fresh")}
    return out


def delivery(d: date) -> dict[str, dict]:
    raw = _get(f"{BASE}/products/content/sec_bhavdata_full_{d.strftime('%d%m%Y')}.csv")
    if not raw:
        return {}
    out = {}
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8", "replace"))):
        r = {k.strip(): (v or "").strip() for k, v in r.items() if k}
        if r.get("SERIES") != "EQ":
            continue
        pct, qty = _num(r.get("DELIV_PER")), _num(r.get("DELIV_QTY"))
        if pct is not None:
            out[r["SYMBOL"]] = {"delivPct": pct, "delivQty": int(qty) if qty is not None else None}
    return out


PART_COLS = {
    "Future Index Long": "idxFutLong",
    "Future Index Short": "idxFutShort",
    "Future Stock Long": "stkFutLong",
    "Future Stock Short": "stkFutShort",
    "Option Index Call Long": "idxCallLong",
    "Option Index Put Long": "idxPutLong",
    "Option Index Call Short": "idxCallShort",
    "Option Index Put Short": "idxPutShort",
    "Total Long Contracts": "totalLong",
    "Total Short Contracts": "totalShort",
}


def participants_on(d: date) -> dict | None:
    raw = _get(f"{BASE}/content/nsccl/fao_participant_oi_{d.strftime('%d%m%Y')}.csv")
    if not raw:
        return None
    lines = raw.decode("utf-8", "replace").splitlines()
    rows = list(csv.reader(lines[1:]))
    if not rows:
        return None
    head = [h.strip() for h in rows[0]]
    out = {}
    for r in rows[1:]:
        if not r or r[0].strip() in ("", "TOTAL"):
            continue
        rec = {}
        for i, h in enumerate(head[1:], start=1):
            key = PART_COLS.get(h)
            if key and i < len(r):
                v = _num(r[i])
                rec[key] = int(v) if v is not None else None
        out[r[0].strip()] = rec
    return out or None


def participants(bdate: date) -> dict | None:
    """Latest participant OI on or before bdate, plus the change vs the session before it."""
    cur, cur_d = None, None
    for i in range(6):
        d = bdate - timedelta(days=i)
        if d.weekday() < 5 and (cur := participants_on(d)):
            cur_d = d
            break
    if not cur:
        return None
    prev = None
    for i in range(1, 8):
        d = cur_d - timedelta(days=i)
        if d.weekday() < 5 and (prev := participants_on(d)):
            break
    for who, rec in cur.items():
        p = (prev or {}).get(who)
        if p:
            rec["chg"] = {k: (rec[k] - p[k]) if rec.get(k) is not None and p.get(k) is not None else None for k in rec}
    return {"date": cur_d.isoformat(), "data": cur}


def build_extras(bdate: date) -> dict:
    ban_date, bans = ban_list()
    return {
        "banDate": ban_date,
        "ban": bans,
        "mwpl": mwpl(bdate),
        "delivery": delivery(bdate),
        "participants": participants(bdate),
    }
