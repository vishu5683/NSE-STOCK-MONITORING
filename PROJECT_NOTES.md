# NSE Stocks Pro: project notes (keep this for new chats)

Personal project, built as a first freelance deliverable. Folder: `Documents\Stock and Exchange Projects\nsestocks`.
**Not part of the TCI Freight repos.** Nothing from this project was added there.

Start a new chat with: "Read PROJECT_NOTES.md in this folder, then continue." (Claude Code also reads `CLAUDE.md`.)

## 1. Goal
A client-ready stock dashboard like the "Professional F&O Excel Screener" PDF (setups, index scanner, heatmap, futures/OI, PCR), but:
- everything free (hosting, data, tools), no monthly Rs 500-1000 cost
- deployable on GitHub Pages or Vercel and shareable with a client
- dashboard + Excel + PDF + admin panel
- data that is real. The PDF showed 0.00% change on every stock, volume spikes of 0.01x, and constant PCR/OI. Those were stale or fallback values, so they were NOT copied.

## 2. Status (10-Nov-2026, v1.1)
Built and tested. Not pushed anywhere yet (no GitHub repo created, no commit made; only `git init`).

Verified in headless Edge:
- production build passes (`npm run build`)
- dashboard, screener, sectors, reports, admin all render, no console errors
- 259/259 stocks and 4 indices load from Yahoo; all 5 health checks pass
- Excel (7 sheets), PDF (5 pages) and CSV download; the Excel file opens in openpyxl with fills, freeze panes and merged title
- admin: login, presets, live preview count, validation blocks Save, saving changes the screener result
- mobile 390px and 360px: no horizontal overflow on any tab, bottom nav fixed, stock sheet opens

Not verified: the GitHub Actions workflow (data refresh, failure issue, Pages deploy) has not run because there is no GitHub repo yet. Vercel deploy not tried. Safari/Firefox and a real phone not tested. Excel was checked with openpyxl, not opened in Microsoft Excel.

### What v1.1 added
- **Mobile:** app-style bottom navigation with icons, data-freshness line under the header, stock details as a bottom sheet, 2-column heatmap, bigger touch targets. On phones the screener shows Symbol, LTP, 1D % and a score bar coloured by signal (green bullish, red bearish, grey none).
- **Monitoring:** `fetch_data.py` runs 5 health checks (symbols loaded, prices moving, data date recent, indices loaded, volume present) and writes them to `meta.health`. If more than half the stocks show 0.00% change it refuses to publish (the bug in the client's old PDF). Failed checks show as a banner on the site and in Admin > Data health. The workflow opens a GitHub issue when a refresh fails (GitHub emails the owner) and closes it when the refresh works again.
- **Freshness:** 3 refreshes per weekday (11:15, 13:30, 16:00 IST). The open page re-checks the data file every 10 minutes. On a weekday with no candle for today the phase reads "NO SESSION TODAY - holiday or feed delay".
- **Excel design:** navy title band, styled headers, zebra rows, grid lines, coloured Signal and Score cells, +/- colours on changes, RSI and volume highlights, frozen header and symbol column, Top 5 tables on the Summary sheet, and a Guide sheet that explains every column.
- **Parameters:** Conservative / Balanced / Aggressive presets, live "with these rules: N bullish, M bearish" preview before saving, validation (for example bullish RSI must be above bearish RSI, Target 2 beyond Target 1).
- **Hardening:** error boundary (a crash shows a reload card, not a blank page), web app manifest (Add to Home Screen), `noindex` so search engines do not list a client's private dashboard.

### Known gaps
- 10-Nov-2026 returned no candle (last session 9-Nov) when fetched at 15:27 and 15:46 IST. Probably an exchange holiday (Diwali Balipratipada); not confirmed. If a normal trading day ever shows yesterday's date after 16:00 IST, Yahoo is late and the 16:00 run will publish old data.
- The 96-hour stale banner will not fire for a single missed day. The health check "Data date is recent" allows 4 days because of weekends and holidays.

## 3. Stack and structure
```
nsestocks/
  data-pipeline/
    universe.csv          259 symbols + sector (from the PDF)
    fetch_data.py         Yahoo Finance -> indicators -> public/data/latest.json
    requirements.txt
  public/
    config.json           default branding + thresholds (edit and redeploy)
    data/latest.json      generated data (committed by the workflow)
  src/
    App.jsx               layout, routing (#/dashboard ...), data load
    lib/signals.js        scoring and setup rules, breadth, sectors
    lib/exporters.js      Excel (write-excel-file), PDF (jsPDF + autotable), CSV
    lib/auth.js           admin password gate
    lib/settings.js       config.json + localStorage overlay
    components/           Dashboard, Screener, StockModal, Reports, Admin, Charts, ui
  .github/workflows/update-data-and-deploy.yml
  vercel.json
```
No backend. The browser loads `data/latest.json` and does all scoring, filtering and file generation itself.

## 4. Data
- Source: Yahoo Finance via `yfinance`, tickers `SYMBOL.NS`, indices `^NSEI ^NSEBANK ^BSESN ^INDIAVIX`. Free, no key, delayed (about 15 min), **unofficial**. Fine for a screener, not for order execution.
- The script exits with an error and keeps the old file if fewer than 70% of symbols load.
- Volume spike compares the last **completed** session with its 20-day average (a still-forming bar has partial volume).
- Daily candles only. No intraday VWAP, no live option chain, no futures OI (no free reliable source).
- Refresh: GitHub Actions at 11:15, 13:30 and 16:00 IST on weekdays, plus a manual "Run workflow" button. GitHub can start scheduled runs 10-30 minutes late, and pauses schedules after 60 days without repo activity.
- Lot sizes were left out on purpose. They change by NSE circular and options are not available.

Other free sources if needed later: NSE F&O UDiFF bhavcopy (end-of-day OI, free, format changed again from 6-Jul-2026), broker APIs (Upstox, Fyers, Angel One SmartAPI are free with an account and give live data and option chain; Zerodha's data API is paid), unofficial NSE website JSON (nsepython) which breaks often and blocks cloud IPs.

## 5. Rules (defaults, editable in Admin)
- Min score 60, volume spike 1.25x, bull RSI >= 53, bear RSI <= 47, ADX >= 18
- Bullish setup also needs price > EMA20 > EMA50 (mirror for bearish)
- Score 0-100: EMA trend 25, RSI 20, ADX 20, volume 15, near 52W extreme 10, MACD 10
- Stop loss = 1.5 x ATR, Target 1 = 2R, Target 2 = 3R (mechanical levels, not advice)
- "Require volume" toggle makes setups stricter (off by default)

## 6. Admin panel
- Login (whole site is gated): password `Vishu@4321` (no username) (in `src/lib/auth.js`). 5 wrong tries lock it for 30 seconds.
- **This is not real security.** The password is inside the JavaScript sent to every visitor. It only keeps casual visitors out of the settings screen. Never put secrets or private client data behind it. For real protection add a serverless function or Cloudflare Access.
- Settings saved in the admin panel live in that browser (localStorage). To make them the default for everyone: Admin > Export settings > paste into `public/config.json` > push.

## 7. Deploy checklist (free)
1. `git init -b main`, create an empty GitHub repo, push.
2. GitHub Pages: Settings > Pages > Source = GitHub Actions. Run "Update data and deploy". Site appears at `https://<user>.github.io/<repo>/`.
3. Vercel (optional second host): import the repo, no settings needed. Redeploys on every data commit.
4. For the client: change name and colours in Admin, export, paste into `public/config.json`, push. Optional: custom domain (domain itself costs money; the subdomain is free).
5. A private GitHub repo works with Pages only on paid plans. For free, use a public repo, or use Vercel (free, works with private repos).

## 8. Things to tell the client / check before selling
- Data is delayed and unofficial; say so (the footer and PDF already do).
- Selling or sharing buy/sell signals with the public can fall under SEBI research analyst / investment adviser rules in India. Check this before charging for signals. This is a flag, not legal advice.
- Yahoo Finance terms limit commercial redistribution. If the client wants paid/commercial use, move to a licensed source (NSE data, or a broker/vendor feed).

## 9. Ideas for next versions
- Real option chain, PCR and max pain through a broker API (Upstox/Fyers) in a small serverless function
- Intraday candles (5 min) for VWAP and 9/15 EMA, via a broker API
- Alerts to Telegram when a stock becomes a setup (GitHub Actions + Telegram bot, free)
- Watchlist sync across devices (needs a free DB such as Supabase)
- Backtest page: how setups performed over the last year
- Real login (Supabase auth or Cloudflare Access)

## 10. Commands
```
npm install
pip install -r data-pipeline/requirements.txt
npm run data       # refresh public/data/latest.json
npm run dev        # local dev server
npm run build      # production build into dist/
```

## 11. Cost
Rs 0. GitHub Pages / Vercel free tiers, GitHub Actions free minutes (each run is about 2 minutes), Yahoo data free. A custom domain is the only optional cost.

## 12. Comparison with the client's PDF (checked 10-Nov-2026)
The PDF (header date 08-11-2026, a Sunday) is really the **6-Nov-2026 close**. Our pipeline run on the same 6-Nov data, 7 stocks:
- LTP and 52W high: exact match (one 52W-high difference: ICICIBANK, PDF 1575.9 vs ours 1571.2).
- RSI: within 0.5 points. ADX: within 3 points. EMA 20/50: within about 1%. EMA 200: up to 2.5% apart. ATR: PDF about 5% lower.
- The gaps are method differences (we use Wilder ATR/ADX and EMAs seeded on 2 years of history). Ours are the standard textbook versions.
- Not in the PDF but we have: health checks, rule presets, mobile layout, Guide sheet.
- In the PDF but NOT here, on purpose (no free reliable source): intraday VWAP and 9/15 EMA signals, index option scanner with premiums, option strike (ATM) column, futures price/basis/OI, PCR, call/put OI support and resistance, max pain.
- Added after the comparison (v1.2): Rank, Conviction, Open/High/Low/Prev close, Value (Cr), Lot size, weekly and monthly status labels, 52-week breakout status, new Excel sheets Momentum and Breakouts.
- Lot sizes in `data-pipeline/lot_sizes.csv` were copied from the PDF. NSE revises them, so refresh before any real use.

## 13. Live prices (v2.0, 11-Nov-2026)
- **Production = Vercel** (free). GitHub Pages is static and cannot hold a token, so there it stays on daily data. Same code works on both; the site detects `/api/health`.
- `api/` (Vercel functions): `login.js` (server checks `SITE_PASSWORD`, returns a signed 12 h token, 5 wrong tries lock the IP for 60 s), `quotes.js` (needs that token, reads Upstox LTP v3 with `UPSTOX_ANALYTICS_TOKEN`, 6 calls of 50 keys, 4 s in-memory cache so Upstox is hit at most about 90 times a minute however many people watch, serves last good prices as `stale` for up to 5 min if Upstox fails), `health.js`. Env vars: `UPSTOX_ANALYTICS_TOKEN`, `SITE_PASSWORD`, `SESSION_SECRET`.
- Upstox Analytics Token: read-only, valid 1 year, market quote needs no static IP (checked in Upstox docs on 11-Nov-2026). Only one active per account.
- `api/_instruments.json` = symbol -> Upstox key (257 of 259; no key for ICICIPRULI, HFCL, they stay on daily data). Rebuild with `npm run instruments`.
- Browser: `src/lib/liveApi.js` polls every 5 s in market hours, 60 s otherwise, backs off when failing, goes back to sign-in if the session expires. Local `npm run dev` still uses the WebSocket plugin in `server/` (OAuth login, token in `.upstox-token.json`, gitignored).
- **Login screen is OFF for now**: `LOGIN_ENABLED = false` in `src/lib/auth.js` (code kept). The live API is open when `SITE_PASSWORD` is not set on the server. To bring login back: set `LOGIN_ENABLED = true` and set `SITE_PASSWORD` + `SESSION_SECRET` on Vercel.
- With the API present and login on, the sign-in password is checked on the server (real security for prices). Without it the old client-side check is used.
- Live only updates price, day change, 52W distance. RSI, EMA, ADX, volume spike, weekly/monthly status stay from the last daily candle.
- Fixed a decoder bug in `server/decodeFeed.js` (frames with 2+ stocks were dropped), added reconnect backoff and cleanup to the dev plugin.
- Tests: `npm test` (19 tests: decoder, live merge, API login/quotes/caching/failure modes, market hours). The workflow runs them before every deploy.
- Verified with a simulated Vercel (real handlers, mocked Upstox) in headless Edge: wrong/right password, live banner and prices, Upstox down, rejected token, expired session, static fallback. NOT verified: a real Upstox response and a real Vercel deploy.
- Caution: Upstox's API is meant for the account holder. Showing its prices to a paying client may need Upstox's permission or a licensed feed. Check their terms before selling.
