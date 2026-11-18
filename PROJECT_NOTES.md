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

### 15i. Dashboard v2, downloads off (11-Nov-2026)
- Dashboard: Market Mood hero (mood from breadth, NIFTY change and NIFTY vs VWAP; six tiles that open the matching Pro Sheet tab: matched, intraday BUY / SELL, setups, FII index futures long %, F&O ban), index cards with VWAP side / PCR / ATM chips, heatmap without an inner scroll (top 8 + bottom 4, link to all), 'View all' on every list (opens the Pro Sheet tab via localStorage nsestocks.scanView), new lists 'Intraday signals now' and 'Opening range breakouts'.
- src/lib/features.js DOWNLOADS_ENABLED = false: Reports tab and per-sheet Excel buttons hidden (code kept). The client tracks live on screen only. Admin config export stays.

### 18. Phase 3: Telegram alerts (17-Nov-2026, login stays off)
- New `/api/telegram.js` (+ `api/_lib/telegram.js`): forwards a signal alert to one Telegram chat via the Bot API. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are Vercel env vars only (never in the bundle). No-op (`ok:false, reason:'NOT_CONFIGURED'`) until both are set; 404s harmlessly on GitHub Pages (no backend there).
- Reuses the existing in-browser detector (`alertEvents` in `Scanners.jsx`) instead of a new server-side comparison: new setup match, intraday BUY/SELL, and ORB break/pullback are the same three events that already drive the toast + browser Notification. Whenever that batch fires (alerts toggle on, page open), the same text is also POSTed to `/api/telegram`, fire-and-forget.
- **Hardened 18-Nov-2026:** the browser no longer sends message text. Body is `{ screen, items: [{ s, k, p? }] }`; `s` must be in `_instruments.json` stocks, `k` one of `new, bull, bear, buy, sell, orb_up, orb_down`; the server builds the text, so the open endpoint cannot be used to post links or phishing text. Origin must be this host (or `ALLOWED_ORIGINS`), token required when login is on, 10 calls/min per IP and 60 per 10 min overall (429 after).
- One alert per screen + symbol + kind per IST day: `src/lib/alerts.js` (`dispatchAlerts`, localStorage, shared by all tabs) and the same rule server-side in memory (covers a second viewer on a warm instance; a cold instance forgets, so a true cross-viewer guarantee needs Redis, see the cron plan). Stops flapping and multi-tab duplicates.
- Lens alerts follow query + sector only (not the search box). Editing the query or sector resets the baseline instead of alerting; no baseline until fundamentals and rows have loaded.
- **Known limit: only fires while someone has the site open in a browser tab** (same as the existing toast/Notification alerts) — there is no always-on server poll. GitHub Actions free schedule is unreliable/can pause (section 15e), and Vercel Hobby cron is once-a-day (section 15g), so neither is frequent enough to replace the live browser tick for this. If always-on (tab closed) alerts are wanted later, that needs either a paid/more-frequent cron or a small always-on poller (e.g. a cheap always-on worker), not attempted here.
- Setup (user's own Telegram, 2 steps): (1) message `@BotFather` on Telegram, `/newbot`, copy the token it gives; (2) message the new bot once, then open `https://api.telegram.org/bot<token>/getUpdates` in a browser to read `message.chat.id` (or add the bot to a group and use the group's chat id, which is negative). Put both in Vercel > Project > Settings > Environment Variables as `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`, redeploy. Nothing to do on GitHub Actions/Pages side.
- Tests: 5 new cases in `tests/api.test.js` (not configured = no-op, GET rejected, empty text rejected, forwards body to the Bot API, per-IP throttle). Full suite 53/53, `npm run build` clean.
- Login explicitly stays OFF (`LOGIN_ENABLED = false`, section 13) per the user's instruction this round; revisit only when asked.

### 19. Lens: query-builder screener (17-Nov-2026), modelled on the client's reference site
- Client reference: `marketlens.nseindia.in` ("NSE Market Lens", BETA) -- a fundamentals query builder ("Price to Book (P/B) < 3 AND Net Profit (in Lakhs) > 100 AND Promoter Holding (%) > 50"), a Ratio Gallery of quick-insert fields, results table with Sector + Sub Sector columns, "Popular Screens" preset cards.
- New, additive-only tab "Lens" (`src/components/Lens.jsx`, nav + route in `App.jsx`) -- does not change Dashboard/Scanners/Screener/Reports/Admin.
- **Fundamentals gap**: the existing pipeline only has Yahoo technical data (price/RSI/EMA/volume) and NSE F&O data (OI/PCR) -- no P/E, P/B, debt/equity, net profit, market cap, promoter holding anywhere. R&D'd the free options (NSE bulk fundamentals API: none free; Screener.in/Trendlyne: no free API, scraping against ToS): **Yahoo `.info`** (`yfinance.Ticker(...).get_info()`) is the only free bulk-ish source, one HTTP call per symbol (not batched like the chart/spark endpoints), so it runs as its own **daily** job: `data-pipeline/fundamentals.py` -> `public/data/fundamentals.json`, new workflow `.github/workflows/fundamentals.yml` (07:30 IST cron + manual dispatch, independent of the main price workflow so a fundamentals failure never blocks prices). `update-data-and-deploy.yml`'s push `paths-ignore` got `public/data/fundamentals.json` added (one-line, does not change its own behavior).
- **No free source for real NSE promoter holding** (it is a quarterly PDF/XBRL filing, not an API). `promoterPct` is Yahoo's `heldPercentInsiders` -- a rough, often-missing proxy, labelled "Insider Holding % (proxy)" in the UI and in `fundamentals.py`'s own docstring, never called "Promoter Holding". Said this to the user plainly; do not silently relabel it later.
- `src/lib/lens.js`: field registry (Fundamentals / Price / Technical groups, pulling from the merged row + fundamentals.json), AND-only condition evaluator (OR/NOT deferred -- the reference's own default new-row logic is AND too), `queryText` for the human-readable line, 5 `PRESETS` approximating the reference's "Popular Screens" cards, saved screens in `localStorage` (`nsestocks.lensScreens`). Unit tests in `src/lib/lens.test.js`.
- Live alert on the **active** screen (own toggle, `nsestocks.lensAlerts`, independent of the Scanners one): each data refresh, the matched-symbol set is diffed against the previous one; a newly-matching symbol fires a toast + the same `/api/telegram` POST introduced in section 18, text `"<screen name>: NEW match - <symbols>"`. Same known limit as section 18: only fires while the tab is open.
- Table, query rows and presets reuse the existing CSS tokens/classes (`.input`, `.btn`, `.table-wrap.sheet-wrap`, `.grid-tools`, `.alert-toasts`) rather than inventing new chrome; new rules are only the `.lens-*` ones for the condition-builder row layout.
- Tests: 55/55 (`lens.test.js` added), `npm run build` clean. Not yet checked against a live, populated `fundamentals.json` (first daily run hasn't fired yet) or on a real phone.

### 20. Server-side Lens alerts (18-Nov-2026) -- alerts with no browser open
- Lens "📡 Watch" adds the current screen (name + sector + conditions) to Upstash Redis (`/api/lens`, max 20; one function for watch + scan because Vercel Hobby allows 12 functions). Watched screens show as chips; "Update watch" when the screen was edited.
- cron-job.org calls `GET /api/lens?scan=1` every 2 min with `Authorization: Bearer <CRON_SECRET>` (same secret as Vercel Cron's `/api/cron-refresh`). It runs only Mon-Fri 09:00-16:00 IST (`?force=1` overrides).
- The scan builds the same rows as the browser by importing `src/lib/live.js`, `signals.js`, `lens.js` (data from `/data/latest.json`, `/data/fundamentals.json`, `/config.json` of this deployment + `liveQuotes()` (Upstox, Yahoo fallback) + `getIntraday()`), diffs each watched screen against `lens:last`, sends new matches via `deliver()`.
- First scan of a new or edited screen only sets the baseline. Dedupe `alert:sent:<IST day>` is a Redis set shared by browser `/api/telegram`, every function instance and the scanner, so no repeats across viewers either.
- Env (Vercel): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (+ existing `CRON_SECRET`, `TELEGRAM_*`). Without Upstash, Watch is hidden and the scan answers 503.
- Lens remembers the last screen across reloads (`nsestocks.lensActive`).
- Pro Sheet (Scanners) alerts are still browser-only.

### 21. Phase 4 (17-Nov-2026): accurate data, faster and clearer alerts, daily messages
- **Stale Yahoo bars fixed**: on 17-Nov, 92 of 259 stocks ended on Fri 13-Nov (Yahoo late). `fetch_data.fill_missing_sessions` now appends the missing completed sessions from NSE `sec_bhavdata_full` before indicators are built; `meta.filledFromNse` lists them; health check "All stocks on the latest session".
- **Daily NSE comparison**: `data-pipeline/reconcile.py` (workflow step after fetch) compares close/open/high/low (0.05%) and volume (1%) with NSE `sec_bhavdata_full` for `lastTradingDate` -> `meta.recon` (`ok` / `mismatch` / `pending`).
- **Scanner**: scans Mon-Fri 09:15-15:35 IST (no pre-open); skips a day with no 5-min bars (NSE holiday, baseline kept); holds back an alert when Upstox and a fresh (<3 min) Yahoo price differ by more than 1% (re-checked next scan, owner warned once).
- **Alert text** (server-built): `📡 screen`, the screen's query, `• SYMBOL ₹price (+x.xx%)`, `🕒 HH:MM IST`. Browser alerts send price/change too.
- **Daily messages** via `/api/lens?daily=open|close|health` (CRON_SECRET): 09:20 running/holiday + watched screens, 15:45 day summary (counts from `alert:count:<day>`), 20:45 data-health report to `TELEGRAM_OWNER_CHAT_ID` (falls back to `TELEGRAM_CHAT_ID`). Owner warnings once a day: Upstox down (Yahoo backup), Upstox token expiry within 30 days (JWT `exp`).
- **Header Alerts panel** (`AlertsPanel.jsx`, `alertPrefs.js`): one bell in the header; popup with the browser switches (Pro Sheet signals, Lens screens) and the Telegram watch list. Per-page Alerts buttons removed. Popup is portalled to `body` (the desktop header's backdrop-filter clips fixed children).
- **Shared OI cache**: `/api/oi` snapshot + refresh lock in Redis (`oi:snap`, `oi:lock`), one ~410-call Upstox refresh per 5 min for the whole deployment; chain popup serves its last chain on a rate limit.
- **Functions**: 10 of Vercel Hobby's 12 (`/api/stock?kind=candles|chain|depth` replaced three; old URLs rewritten in vercel.json). Test fails above 12.
- cron-job.org jobs (Asia/Kolkata, header `Authorization: Bearer <CRON_SECRET>`): scan `* 9-15 * * 1-5`, open `20 9 * * 1-5`, close `45 15 * * 1-5`, health `45 20 * * 1-5`.

### 15j. Upstox live on (11-Nov-2026)
- UPSTOX_ANALYTICS_TOKEN is set in Vercel (Production). /api/quotes source = upstox, SENSEX is now live too. Yahoo stays the automatic fallback.
- ICICIPRULI is now ICICILIFE on NSE (same company, 438.40 close on 9-Nov). Renamed in universe.csv and lot_sizes.csv.
- build-instruments.mjs also takes the BE series when a stock has no EQ row (HFCL moved to trade-for-trade). Map is 259 of 259.

### 16. Phase 2: live F&O from Upstox (11-Nov-2026)
- api/_lib/upstoxOi.js + /api/oi: one v2/option/chain call per F&O underlying (205 stocks + NIFTY + BANKNIFTY), nearest unexpired expiry from _instruments.json 'fo', paced to ~20 req/s (Upstox allows ~50/s; 10 parallel calls got HTTP 429 on 84 of 207), one retry on 429, cached 5 min. Summary fields match the bhavcopy layer (pcr, callOiRes, putOiSup, callWriting(+Oi), putWriting(+Oi), maxPain, step, iv from ATM greeks, optExpiry, ceOi, peOi). Near-month futures via v2/market-quote/quotes (full): futLive, futOiLive, futVolLive, futCp = last_price - net_change (ohlc.close is the running close).
- /api/chain?s=SYMBOL: live strike chain for the popup (ATM +/-10, indices +/-30), cached 60 s; F&O names only.
- Browser: applyOi (live.js) only while meta.foDate < live day, so the evening NSE files win once they are in. Futures OI change = live OI - previous NSE close OI; build-up from futures price vs previous close and that change. Labels switch between (live) and (EOD).
- build-instruments.mjs writes 'fo' (underlying key, futures [expiry,key], option expiries); the workflow runs it daily and commits api/_instruments.json.
- vercel.json maxDuration 30 s. Checked live 11-Nov 17:24 IST: 205 option chains + 205 futures, 0 failed; RELIANCE PCR 0.78 vs NSE EOD 0.80; NIFTY ATM IV 17.8 vs India VIX 17.6.
- Not done: index ITM / ATM / OTM premium table still reads the end-of-day chain.json.

### 17. Phase 2.5 (12-Nov-2026)
- Tick-by-tick prices: src/lib/liveFeed.js connects the browser straight to the Upstox V3 market feed (ltpc mode, 263 keys in batches of 100). /api/feed-url returns the one-time wss URL (token stays on the server) plus the key -> symbol map. Ticks are flushed to state once a second; while ticks arrive (last tick < 15 s) the 5 s /api/quotes polling is skipped; 5 reconnects with backoff, then polling only. Market hours only. Switch: WS_ENABLED in src/lib/features.js. server/decodeFeed.js now runs on Uint8Array + TextDecoder (browser and Node). Live check 11:11 IST: 138 frames and 27 of 30 prices changed in 6 s.
- Greeks: chain rows carry indices 9-16 (ceIv, ceDelta, ceTheta, ceGamma, ceVega, peIv, peDelta, peTheta) from Upstox option_greeks; chain popup shows CE/PE delta and IV columns and ATM greeks tiles. 0-8 unchanged, so chain.json readers still work.
- /api/depth?s=: 5-level bid / ask, total buy / sell qty, average price, circuits (full quote); stock popup 'Order book (live)', refreshed every 5 s.
- Pro chart: src/components/ProChart.jsx with lightweight-charts 4.2.3 (lazy chunk ~52 KB gz). Built once; candles and price lines update in place (levels change on every tick because the plan uses the live price; rebuilding reset the zoom). SVG CandleChart is the fallback.
- Live intraday layer adds Supertrend (10,3, Wilder ATR), Bollinger (20,2, %B), slow Stochastic (14,3,3), 15-minute trend (EMA 9 / 21 on 15-min bars built from 5-min) and RSI 15m. Intraday sheet + popup show them.
- /api/candles reads Upstox v3 intraday 5-min candles first, Yahoo as fallback (payload.source).
- /api/oi in market hours: 207 chains took longer than the 30 s function limit at 4 parallel; now 12 parallel paced at 25/s with a 22 s budget (8.9 s measured, 0 failed). First OI after page load takes ~10 s; labels show EOD until then.
- Not done: OI / PCR trend over the day and browser push alerts need storage (Upstash Redis free tier); Telegram skipped by the user.

## 22. Client sheet update of 18-Nov-2026: EMA 9/21 and the F&O Derivatives tab
- The sheet moved its intraday EMA pair from 9/15 to 9/21. `screener.emaSlow` (default 21, Admin can pick 15) drives Intraday, Profitable Setups, Index Options and the Excel export. Rows without `ema21i` fall back to 15.
- New Pro Sheet tab **F&O Derivatives** (sheet tabs "NSE F&O Derivatives" + "NSE F&O Settings"): 5-minute EMA 9/21 cross within `fno.lookback` bars, price vs EMA 50, ADX 14 >= `fno.adx`, SMC zone, last complete 5-minute bar volume vs the average 5-minute bar of the previous 10 sessions >= `fno.volX`. SL / T1 / T2 = 5-minute ATR x the screener multipliers. Settings in Admin.
- SMC zone (`smcZone` in `api/_lib/intraday.js`): demand = last down candle before a close at least 1 ATR above its high within three bars, valid until a close below its low; supply is the mirror; price inside or within 0.25 ATR = in the zone. The sheet does not publish its own SMC rule, so this is our stated definition.
- `/api/intraday` now asks Yahoo for one month of 5-minute bars (indicators still use the last 5 sessions, the volume base the 10 before today). Full refresh of 259 stocks measured at ~6 s, payload ~160 KB.
- Pipeline fix the same day: the NSE fill now also adds a session NSE has published when Yahoo is late for every stock (18-Nov 04:00 IST run had all 259 on 16-Nov).
