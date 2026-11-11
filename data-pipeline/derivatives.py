"""
F&O layer from the NSE end-of-day bhavcopy (public archive files, no login, no scraping).

Per F&O symbol (stocks + NIFTY / BANKNIFTY):
  * near-month futures: price, basis, OI, change in OI, build-up (long / short / covering / unwinding)
  * nearest option expiry: PCR, call OI resistance, put OI support, heaviest call / put writing,
    max pain, ATM strike from the listed strikes, ATM implied volatility (Black-Scholes on the close)
  * official lot size
  * company name (from the cash-market bhavcopy)
Also writes a strike-wise option chain (ATM +/- 10 strikes) to public/data/chain.json for the chain view.

This is end-of-day data of the last published session, clearly dated in the app. Live intraday OI
needs a broker feed (Upstox) and is not invented here.
"""
from __future__ import annotations

import csv
import io
import math
import urllib.request
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta

# keep it plain: the NSE archive host stalls requests whose User-Agent carries a URL
UA = {"User-Agent": "nsestocks-pro-data/1.0"}
FO_URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{d}_F_0000.csv.zip"
CM_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{d}_F_0000.csv.zip"
INDEX_MAP = {"NIFTY": "NIFTY 50", "BANKNIFTY": "BANK NIFTY"}
RATE = 0.065  # risk-free rate for IV
CHAIN_WIDTH = 10


def _get_csv(url: str) -> list[dict] | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            raw = r.read()
        z = zipfile.ZipFile(io.BytesIO(raw))
        return list(csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8")))
    except Exception:
        return None


def latest_bhavcopy(today: date, lookback: int = 8) -> tuple[date | None, list[dict] | None, list[dict] | None]:
    """Newest published F&O bhavcopy on or before today (NSE posts it in the evening)."""
    for i in range(lookback):
        d = today - timedelta(days=i)
        if d.weekday() >= 5:
            continue
        fo = _get_csv(FO_URL.format(d=d.strftime("%Y%m%d")))
        if fo:
            cm = _get_csv(CM_URL.format(d=d.strftime("%Y%m%d")))
            return d, fo, cm
    return None, None, None


def _f(x) -> float | None:
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _ncdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(spot: float, strike: float, t: float, vol: float, call: bool) -> float:
    if t <= 0 or vol <= 0:
        return max(0.0, (spot - strike) if call else (strike - spot))
    d1 = (math.log(spot / strike) + (RATE + vol * vol / 2) * t) / (vol * math.sqrt(t))
    d2 = d1 - vol * math.sqrt(t)
    if call:
        return spot * _ncdf(d1) - strike * math.exp(-RATE * t) * _ncdf(d2)
    return strike * math.exp(-RATE * t) * _ncdf(-d2) - spot * _ncdf(-d1)


def implied_vol(premium: float, spot: float, strike: float, t: float, call: bool) -> float | None:
    if not premium or premium <= 0 or t <= 0:
        return None
    intrinsic = max(0.0, (spot - strike) if call else (strike - spot))
    if premium <= intrinsic:
        return None
    lo, hi = 0.01, 5.0
    for _ in range(80):
        mid = (lo + hi) / 2
        if bs_price(spot, strike, t, mid, call) > premium:
            hi = mid
        else:
            lo = mid
    v = (lo + hi) / 2
    return v if 0.011 < v < 4.99 else None


def buildup(price_chg: float | None, oi_chg: float | None) -> str:
    if price_chg is None or oi_chg is None or oi_chg == 0:
        return "-"
    if price_chg >= 0 and oi_chg > 0:
        return "LONG BUILDUP"
    if price_chg < 0 and oi_chg > 0:
        return "SHORT BUILDUP"
    if price_chg >= 0 and oi_chg < 0:
        return "SHORT COVERING"
    return "LONG UNWINDING"


def _live_expiry(rows: list[dict], bdate: date) -> list[dict]:
    """Contracts that expire after the bhavcopy date. On expiry day the expiring series is useless for the next session."""
    later = [r for r in rows if r["XpryDt"] > bdate.isoformat()]
    return later or rows


def _summarise(sym: str, futs: list[dict], opts: list[dict], bdate: date) -> tuple[dict, dict | None]:
    out: dict = {}
    spot = None
    if futs:
        f = min(_live_expiry(futs, bdate), key=lambda r: r["XpryDt"])
        price = _f(f["ClsPric"])
        prev = _f(f["PrvsClsgPric"])
        oi = _f(f["OpnIntrst"]) or 0
        doi = _f(f["ChngInOpnIntrst"]) or 0
        spot = _f(f["UndrlygPric"])
        out.update(
            futExpiry=f["XpryDt"],
            futPrice=price,
            futBasis=round(price - spot, 2) if price and spot else None,
            futOi=int(oi),
            futOiChg=int(doi),
            futOiChgPct=round(doi / (oi - doi) * 100, 2) if oi - doi > 0 else None,
            futVol=int(_f(f["TtlTradgVol"]) or 0),
            futBuildup=buildup((price - prev) if price and prev else None, doi),
            lot=int(_f(f["NewBrdLotQty"]) or 0) or None,
        )
    if not opts:
        return out, None
    expiry = min(r["XpryDt"] for r in _live_expiry(opts, bdate))
    near = [r for r in opts if r["XpryDt"] == expiry]
    spot = spot or _f(near[0]["UndrlygPric"])
    if not spot:
        return out, None
    ce: dict[float, dict] = {}
    pe: dict[float, dict] = {}
    for r in near:
        k = _f(r["StrkPric"])
        if k is None:
            continue
        rec = {"oi": _f(r["OpnIntrst"]) or 0, "doi": _f(r["ChngInOpnIntrst"]) or 0, "ltp": _f(r["ClsPric"]), "vol": _f(r["TtlTradgVol"]) or 0}
        (ce if r["OptnTp"] == "CE" else pe)[k] = rec
    strikes = sorted(set(ce) | set(pe))
    if len(strikes) < 3:
        return out, None
    ce_oi = sum(v["oi"] for v in ce.values())
    pe_oi = sum(v["oi"] for v in pe.values())
    atm = min(strikes, key=lambda k: abs(k - spot))
    gaps = sorted(b - a for a, b in zip(strikes, strikes[1:]) if b > a)
    step = gaps[len(gaps) // 2] if gaps else None
    res = max(ce, key=lambda k: ce[k]["oi"]) if ce else None
    sup = max(pe, key=lambda k: pe[k]["oi"]) if pe else None
    cw = max(ce, key=lambda k: ce[k]["doi"]) if ce else None
    pw = max(pe, key=lambda k: pe[k]["doi"]) if pe else None
    # max pain: strike where option writers pay the least at expiry
    pain = min(
        strikes,
        key=lambda s: sum(v["oi"] * max(0, s - k) for k, v in ce.items()) + sum(v["oi"] * max(0, k - s) for k, v in pe.items()),
    )
    days = (datetime.strptime(expiry, "%Y-%m-%d").date() - bdate).days
    t = max(days, 0.5) / 365
    ivs = [
        implied_vol(ce.get(atm, {}).get("ltp"), spot, atm, t, True),
        implied_vol(pe.get(atm, {}).get("ltp"), spot, atm, t, False),
    ]
    ivs = [v for v in ivs if v]
    out.update(
        optExpiry=expiry,
        spotEod=spot,
        pcr=round(pe_oi / ce_oi, 2) if ce_oi else None,
        callOiRes=res,
        putOiSup=sup,
        callWriting=cw if cw is not None and ce[cw]["doi"] > 0 else None,
        callWritingOi=int(ce[cw]["doi"]) if cw is not None and ce[cw]["doi"] > 0 else None,
        putWriting=pw if pw is not None and pe[pw]["doi"] > 0 else None,
        putWritingOi=int(pe[pw]["doi"]) if pw is not None and pe[pw]["doi"] > 0 else None,
        maxPain=pain,
        atmEod=atm,
        step=step,
        iv=round(sum(ivs) / len(ivs) * 100, 1) if ivs else None,
        ceOi=int(ce_oi),
        peOi=int(pe_oi),
    )
    i = strikes.index(atm)
    width = CHAIN_WIDTH * 3 if sym in INDEX_MAP else CHAIN_WIDTH  # indices move many strikes in a day
    window = strikes[max(0, i - width) : i + width + 1]
    chain = {
        "expiry": expiry,
        "spot": spot,
        "atm": atm,
        "rows": [
            [k, *(lambda c: [int(c["oi"]), int(c["doi"]), c["ltp"], int(c["vol"])])(ce.get(k, {"oi": 0, "doi": 0, "ltp": None, "vol": 0})),
             *(lambda p: [p["ltp"], int(p["doi"]), int(p["oi"]), int(p["vol"])])(pe.get(k, {"oi": 0, "doi": 0, "ltp": None, "vol": 0}))]
            for k in window
        ],
    }
    return out, chain


def build_derivatives(today: date) -> dict | None:
    """Returns {date, stocks: {SYM: summary}, indices: {NAME: summary}, chains: {SYM: chain}, names: {SYM: name}}."""
    bdate, fo, cm = latest_bhavcopy(today)
    if not fo:
        return None
    futs: dict[str, list] = defaultdict(list)
    opts: dict[str, list] = defaultdict(list)
    for r in fo:
        tp = r.get("FinInstrmTp")
        if tp in ("STF", "IDF"):
            futs[r["TckrSymb"]].append(r)
        elif tp in ("STO", "IDO"):
            opts[r["TckrSymb"]].append(r)
    stocks, indices, chains = {}, {}, {}
    for sym in set(futs) | set(opts):
        summary, chain = _summarise(sym, futs.get(sym, []), opts.get(sym, []), bdate)
        if not summary:
            continue
        if sym in INDEX_MAP:
            indices[INDEX_MAP[sym]] = summary
            if chain:
                chains[INDEX_MAP[sym]] = chain
        else:
            stocks[sym] = summary
            if chain:
                chains[sym] = chain
    names = {}
    for r in cm or []:
        if r.get("SctySrs") == "EQ" and r.get("FinInstrmNm"):
            names[r["TckrSymb"]] = r["FinInstrmNm"].strip()
    return {"date": bdate.isoformat(), "stocks": stocks, "indices": indices, "chains": chains, "names": names}
