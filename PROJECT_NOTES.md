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

## 5. Rules (defaults, editable in Admin; since 11-Nov-2026 the default is the "Client sheet" preset, see section 15)
- Min score 60, volume spike 2x, bull RSI >= 55, bear RSI <= 45, ADX >= 22 (Client sheet preset)
- Bullish setup also needs price > EMA20 > EMA50 (mirror for bearish)
- Score 0-100: EMA trend 25, RSI 20, ADX 20, volume 15, near 52W extreme 10, MACD 10
- Stop loss = 1.5 x ATR, Target 1 = 1.5R, Target 2 = 2.5R (mechanical levels, not advice)
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

## 14. Yahoo live fallback (11-Nov-2026)
- `api/quotes.js` tries Upstox first, then Yahoo (`api/_lib/yahoo.js`, spark endpoint, max 20 symbols per call, 14 parallel calls, 15 s cache). A rejected Upstox token blocks Upstox for 10 minutes so requests do not waste calls. Response carries `source` (`upstox`|`yahoo`), `fallbackReason`, `lagMin`.
- **Measured at 10:25 IST on 11-Nov-2026 (market open): Yahoo NSE stocks and indices were 0 minutes old; SENSEX was 16 minutes late.** An earlier note saying "Yahoo is 15 minutes delayed" was wrong for NSE. It is unofficial though, so it can change or throttle without notice, and Vercel server IPs may be treated differently from this PC. Not yet checked on a real Vercel deploy.
- Upstox needs an active account (segments). The Basic plan showed "reactivate your account"; until that is done the site runs on Yahoo.
- Tests: 25 (`npm test`).

## 15. Scanners page = client's Google Sheet (11-Nov-2026)

Reference: client's "Professional_F&O_Excel_Screener" Google Sheet (16 tabs, refreshes every 2-3 min with Apps Script on Yahoo data).
Mapped to the new **Scanners** tab (`src/components/Scanners.jsx`, rules in `src/lib/intraday.js`, tests `intraday.test.js`):

| Sheet tab | Our place |
|---|---|
| Profitable Setups, Dashboard | Scanners > Profitable setups (bull + bear, conviction, ATM, lot, entry/SL/T1/T2, intraday signal, Settings match) + stat tiles |
| Intraday Scanner | Scanners > Intraday (5-min VWAP, EMA 9/15, RSI, MACD, CPR zone, BUY/SELL/WAIT/NO-TRADE) |
| Breakout / Swing Scanner | Scanners > Breakout / Swing |
| Most Active Equities | Scanners > Most active (turnover sort) |
| Index Options Scanner | Scanners > Index options (NIFTY/BANKNIFTY/SENSEX, VWAP, EMA, RSI, ATM, CE/PE bias) |
| Sector Heatmap, TimeframeCache | Sectors tab + Momentum sheet in Excel |
| Option Chain, Futures Data, F&O Screener OI columns | From the **NSE F&O bhavcopy** (official public end-of-day file, `data-pipeline/derivatives.py`): PCR, call/put OI walls, call/put writing, max pain, ATM IV (Black-Scholes on the close), futures price/basis/OI/build-up, official lot size, company names (CM bhavcopy). Strike-wise chain in `public/data/chain.json` (ATM +/-10 strikes, indices +/-30), loaded only when a chain opens. The client sheet's own OI is NOT real (Futures OI = exactly 1.5 x volume, futures = spot x ~1.0035, every row "Moderate"). |
| Settings | Admin > "Client sheet" preset (now the default): Vol 2x, RSI 55/45, ADX 22, score 60, ATR 1.5, T1 1.5R, T2 2.5R, + VWAP / 9-15 EMA / MACD cross / CPR filter switches, wide CPR 0.5% |

- Pipeline: `data-pipeline/intraday.py` downloads 5-min candles (period 5d) for stocks + indices and adds `vwap, ema9i, ema15i, rsiI, macdI, macdIsig, cprBc, cprTc, cprPivot, cprWidthPct, iBars, iAsOf` (and `vwapProxy` for indices: Yahoo has no index volume, so VWAP = mean typical price). Failure there never blocks the daily file. Health check "Intraday (5-min) data".
- Signal, CPR zone, ATM strike are computed **in the browser** against the live price, so they move with each live tick. ATM gap bands are approximate (index steps 50/100/100).
- Sheet's "9/15 EMA" and RSI are **daily** values (HINDPETRO EMA 374/365 at price 403). Ours are true 5-minute values.
- Workflow now runs every 30 min 09:30-15:00 IST + 16:00 (was 3 times a day). Every 5 min would add ~280 KB commits all day.
- Excel report has new sheets "Intraday" and "Index options"; Settings sheet lists the new switches.
- Next with Upstox token: real option chain (PCR, OI support/resistance, IV, max pain), futures OI build-up, intraday candles from Upstox instead of Yahoo.

### 15b. Pro Sheet tabs (11-Nov-2026, later the same day)
- Scanners page title "F&O Pro Sheet", 11 tabs in the sheet's order: Profitable Setups, Dashboard, Most Active, Index Options, F&O Screener, Option Chain, Futures Data, Breakout, Swing, Sector Heatmap, Intraday. Last tab is remembered (localStorage `nsestocks.scanView`).
- Every tab: sort, search (symbol / company / sector), "Excel (this tab)" export (`exportTable` in exporters.js), live price flash, row tap opens the stock or the chain popup.
- Index Options: VWAP, EMA 9/15, RSI, ATM, PCR, max pain, OI walls, IV, master signal (intraday signal must agree with PCR), India VIX note, ITM/ATM/OTM CE+PE premiums from the chain.
- Bhavcopy URLs: `nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_YYYYMMDD_F_0000.csv.zip` (and `/cm/` for names). Use a plain User-Agent `nsestocks-pro-data/1.0`: a UA containing a URL is stalled by the NSE host (timeouts). Posted in the evening; the pipeline walks back up to 8 days. Option expiry = first one after the bhavcopy date.
- Not done on purpose: the NSE live option-chain JSON API sits behind a bot check; scraping it was refused. Live intraday OI comes with Upstox.
- Sheet lot sizes (8-Nov) differ from NSE now (e.g. HINDPETRO 1350 vs NSE 2025); NSE value wins.

### 15c. R&D batch 2 (11-Nov-2026)
More free NSE public archive files in `data-pipeline/nse_extras.py` (same plain User-Agent, all optional):
- F&O ban list `content/fo/fo_secban.csv` (dated file names 404 now) -> `inBan`, `meta.ban`, BAN chip everywhere.
- MWPL `archives/nsccl/mwpl/combineoi_DDMMYYYY.zip` -> `mwplPct`, `noFresh` (95% = ban, 80%+ shown as near ban).
- Delivery % `products/content/sec_bhavdata_full_DDMMYYYY.csv` (EQ series) -> `delivPct`, `delivQty`. Health check "Delivery % (NSE)".
- Participant OI `content/nsccl/fao_participant_oi_DDMMYYYY.csv` (+ the session before for change) -> `meta.participants` -> new tab FII / DII.
- Intraday adds `orbHigh/orbLow` (first three 5-min bars), `dayOpen`, `pdh/pdl/pdc`. Daily adds `nr7`, `insideBar`, `hi20/lo20`, `streak` (last complete session).
- New tab Patterns & ORB (gap, ORB, prev-day range, 20D break, break score x/4, NR7 / inside bar / streak).
- Stock popup: Key levels ladder (pivots R3..S3, prev high/low, ORB, VWAP, CPR, OI walls, max pain, live price slotted in), delivery, MWPL, PCR, build-up, IV, ATM.
- Alerts toggle (localStorage `nsestocks.alerts`): toast + browser Notification when a stock newly matches, gives an intraday BUY/SELL, or breaks its ORB. Fires on data refresh / live tick while the page is open; no server push.
- 10-Nov-2026 had no NSE files and no Yahoo bar (treated as a holiday by the data).

### 15d. UI polish, live indicators, cleanup (11-Nov-2026)
- Pro Sheet is the first nav item and the landing page (`#/` and unknown hashes open it). Nav: Pro Sheet, Dashboard, Screener, Reports, Admin.
- The old Sectors tab is gone (duplicate). Its sector table is now "Sector summary" inside Pro Sheet > Sector Heatmap; tapping a sector opens the Screener filtered to it. Old `#/sectors` links land on Pro Sheet.
- Sheet tables behave like Excel freeze panes: header row and Symbol column stay put (`.sheet-wrap`, column flag `freeze`). Zebra rows, rank folded into the symbol cell.
- Phones: 3-column stat tiles, icon-only alerts button beside a full-width search, faded edges on the tab strip, active tab scrolled into view.
- New `/api/intraday` (Vercel): Yahoo spark, 5 days of 5-minute closes, 20 symbols a call (~14 calls, ~0.7 s), cached 60 s. Returns EMA 9/15, RSI 14, MACD 12/26/9 per stock and index. Browser polls it every minute in market hours and overlays those fields (`applyIntraday` in live.js); VWAP, CPR, ORB, daily indicators and OI still come from the data file. Checked against pandas on the same moment: EMA within ~0.1, RSI within ~0.4.
- Cleanup: removed dead `.login-wrap` CSS, unused exports made private, one shared `cprLabel` for page and Excel, Excel ATM uses the real strike gap.

### 15e. Live intraday on the server, candles, backtest (11-Nov-2026)
- **GitHub schedule is unreliable**: on 11-Nov none of the scheduled runs fired (last scheduled run 10-Nov 23:37 IST). Do not depend on it for intraday data.
- `/api/intraday` now uses the Yahoo **chart** endpoint (one call per symbol, 5 days of 5-min OHLCV, 10 parallel, ~260 calls in ~3-4 s, cached 2 min). It returns EMA 9/15, RSI, MACD, VWAP (stocks: volume-weighted; indices: average typical price, `vwapProxy`), ORB, day open, previous session H/L/C and CPR. Checked against the pipeline: ORB, day open, prev close identical; prev H/L a few paise off (5-min vs daily candle). `applyIntraday` keeps the file's official prev-day levels when the file is from the same session.
- `/api/candles?s=SYMBOL` (known symbols and the 4 index names only): today's 5-min candles with running VWAP, cached 30 s. Stock popup shows "Today 5-min" candle chart (VWAP line, CPR band, ORB, PDH/PDL, SL/T1) next to the 60-day chart; static hosting falls back to the 60-day chart.
- `data-pipeline/backtest.py`: same rules and score as signals.js with public/config.json settings, last ~250 sessions, entry at close, SL 1.5 ATR, T1 1.5R, 10 sessions, stop-and-target-same-day = loss. Result on 11-Nov-2026 (21-Oct-2025 to 9-Nov-2026): 3793 signals, T1 first 25.9%, SL first 47.3%, neither 26.8%, average R -0.02 (bull -0.03, bear -0.02). The client-sheet rules show no edge. Shown only in Admin ("owner only"); per-stock `bt` is in the data for later.

### 15f. Phase 1 hardening (11-Nov-2026)
- Popup v2 (`Modal` in ui.jsx): fixed top bar (title with symbol, live price, change + close button) that never scrolls away; only the body scrolls. Closes on Escape, backdrop, the phone Back button (pushState on open, popstate closes), and a swipe down on the bar (phones). Body is `display: block`: grid/flex there squashed the SVG charts.
- Stock popup order: header, chart (Today 5-min / 60 days), trade plan, key levels, 52W range, then "All indicators" (collapsed on phones, open on desktop).
- Data strip market status is computed from the IST clock and the newest live tick (`marketPhaseNow`): weekend, opens 09:15, pre-open, open, closed, or "no live ticks (exchange holiday?)". The file's phase is only shown in Admin as "when the file was built".
- Correctness check 11-Nov: Yahoo daily close / high / low / volume for 9-Nov vs NSE `sec_bhavdata_full_09112026.csv`: 257 of 257 identical (no difference above 0.05%; volume ratio exactly 1.0).
- Rule R&D (walk-forward, 432 combinations, train before 3-Jul-2026, test after): the client-sheet rules are -0.004R train / -0.063R test. The best train combinations (mostly long, wide targets) lose in the test period (overfit). Only "fresh short" (first day a stock turns into a bearish setup, stop 1-1.5 ATR, target 1-1.5R, 5-20 sessions) stayed positive in both (+0.04 to +0.12R per trade), which is small and from one market regime. Defaults NOT changed. Script: scratchpad sweep.py (not in repo).

### 15g. Daily refresh from Vercel (11-Nov-2026)
- `vercel.json` "crons": `/api/cron-refresh` at `30 13 * * 1-5` (19:00 IST) and `0 3 * * 1-5` (08:30 IST). Hobby plan runs each cron once a day, somewhere inside that hour.
- `/api/cron-refresh` accepts only `Authorization: Bearer $CRON_SECRET` (Vercel sends it), then POSTs GitHub `workflow_dispatch` for `update-data-and-deploy.yml` on `main` with `GH_DISPATCH_TOKEN` (fine-grained token, this repo only, Actions read and write). The workflow commits `public/data/*.json`, the commit redeploys Vercel.
- GitHub schedule cut to one backup run at 20:00 IST. The old every-30-minutes intraday schedule is gone: intraday is live on Vercel.
- A push to main still runs the workflow (tests, build, Pages) and Vercel deploys the push by itself.

### 15h. Pro Sheet UX v3 (11-Nov-2026, client feedback: "looks like a plain Excel, tiny tabs, the table scrolls when I scroll the page")
- One vertical scroll only: the page. `.sheet-wrap` is `overflow-x: auto` with no height limit and no `overscroll-behavior: contain` (that blocked the wheel from reaching the page). The sticky header inside the box is gone with it; the frozen Symbol column still works for sideways scroll on desktop.
- Phones (`usePhone`, max-width 680px): every sheet table renders as cards (symbol + LTP + change on top, the columns a phone would show below, plus columns flagged `card: true`, e.g. Entry / Stop Loss / Target 1). "Sort by" select instead of header clicks. Tab picker: big current-tab button with prev / next arrows that opens a list of all 13 sheets with a one-line meaning each.
- Desktop: icon tab buttons that wrap (no hidden overflow), and a title + one-line meaning above each sheet.
- Live info banner is one line (details on tap). The Upstox "no key for" note only shows when Upstox is the source. On phones the matched list, the card title and the repeated tab name are hidden.
- Checks: scratchpad e2e/ux3.mjs (13 tabs x phone + desktop: data present, no scroll traps, no sideways scroll, no NaN, wheel moves the page) and e2e/final.mjs (popups, Back, chain, downloads, pages, theme) against the live URL.
