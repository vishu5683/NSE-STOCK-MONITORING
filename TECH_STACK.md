# NSE Stocks Pro: technology and architecture

Live: https://nsestock-five.vercel.app · Code: https://github.com/vishu5683/NSE-STOCK-MONITORING
Built Nov 2026. A real-time NSE F&O screener and trading dashboard that replaced a client's Google Sheets / Excel scanner.

## 1. What it does
- 259 NSE F&O stocks + NIFTY, BANK NIFTY, SENSEX, India VIX.
- Tick-by-tick prices, live option chain (OI, PCR, max pain, IV, Greeks), futures OI build-up, order book.
- 13 "Pro Sheet" tabs that mirror the client's Excel (setups, intraday, breakout, swing, option chain, futures, FII/DII, heatmap, patterns).
- Rule-based signals (daily + intraday), ATM strike, entry / stop loss / targets, alerts, backtest.
- Phone and desktop UI, dark and light theme.

## 2. Architecture
```
Browser (React SPA)
  |-- WebSocket (binary protobuf) --> Upstox V3 market feed      tick-by-tick prices
  |-- polling --> Vercel serverless API (Node)                    5 s / 2 min / 5 min
  |                 |-- Upstox REST: LTP, option chain, quotes, depth, intraday candles
  |                 |-- Yahoo Finance: 5-minute candles (fallback / bulk indicators)
  |                 '-- GitHub API: dispatch the data workflow (from Vercel Cron)
  '-- static JSON (public/data/*.json) built by the data pipeline

GitHub Actions (Python data pipeline) --commit--> repo --> Vercel redeploy
  |-- Yahoo Finance daily + 5-minute candles (yfinance, pandas)
  '-- NSE public archives: F&O bhavcopy, ban list, MWPL, delivery %, participant OI
```

## 3. Stack and why each piece is there

| Layer | Technology | Why |
|---|---|---|
| UI | **React 18** (hooks, memo), **Vite 5** | Fast SPA, code-splitting (chart library loads only in the popup) |
| Styling | Plain CSS with CSS variables, mobile-first, dark / light themes | No framework weight; freeze panes, cards on phones |
| Charts | **TradingView Lightweight Charts 4** (open source) + custom SVG | Zoom / crosshair candlesticks with VWAP, EMA, price lines; SVG fallback |
| Real-time | **WebSocket** + **Protocol Buffers** (hand-written decoder) | Tick-by-tick Upstox V3 feed in the browser, token kept on the server |
| API | **Node.js 22 serverless functions on Vercel** (ESM) | Free hosting, token stays server-side, caching and fan-out |
| Market data | **Upstox API v2/v3** (LTP, market quote full, option chain, intraday candles, feed authorize) | Official exchange data: prices, OI, Greeks, depth |
| Fallback data | **Yahoo Finance** chart / spark endpoints | No-account backup; bulk 5-minute candles |
| EOD data | **NSE public archives** (F&O bhavcopy, CM bhavdata, combineoi, fo_secban, participant OI) | OI, PCR, max pain, IV, delivery, ban list, FII/DII without scraping |
| Pipeline | **Python 3.12**, **pandas**, **NumPy**, **yfinance** | Indicators, derivatives summary, backtest |
| Scheduling | **GitHub Actions** + **Vercel Cron** -> GitHub `workflow_dispatch` | Reliable daily refresh (GitHub's own cron is often late) |
| Exports (switchable) | write-excel-file, jsPDF + autotable | Excel / PDF / CSV reports (currently off by product decision) |
| Testing | **node:test** (52 unit / API tests), **Puppeteer** end-to-end on desktop + phone | Regression on every change, checks against the live site |
| Monitoring | Health checks in the data file, GitHub issue on failure, scheduled cloud checks | Daily pass / fail reports |
| Security | Server-side tokens, HMAC session tokens, timing-safe compare, login lockout, `no-store` cache headers, symbol allow-lists | No credentials in the browser, no open proxy |

## 4. Algorithms implemented
- Indicators: EMA, RSI (Wilder), MACD, ADX, ATR, VWAP, Supertrend, Bollinger Bands, slow Stochastic, 15-minute trend from 5-minute bars, CPR, classic pivots, opening range (ORB), NR7, inside bar, 52-week and 20-day breakouts.
- Derivatives: put-call ratio, OI walls, call / put writing, **max pain**, ATM strike from the listed strikes, **implied volatility (Black-Scholes, bisection)**, futures basis and long / short build-up, MWPL ban risk.
- Scoring and signals: multi-factor conviction score, daily setups, intraday BUY / SELL / NO-TRADE, settings match.
- Backtest: walk-forward test (train / test split) of the rules over a year, win rate and average R.

## 5. Engineering problems solved
- Upstox rate limits: paced fan-out (12 parallel, ~25 req/s), retry on 429, 22 s budget inside a 30 s function limit (207 option chains in ~9 s).
- Protobuf decoding bug (varint evaluation order) and a browser-compatible decoder.
- Chart rebuilt on every tick (reset zoom): build once, update data and price lines in place.
- Data correctness: verified Yahoo OHLCV against NSE official files (257/257 exact), filtered absurd IVs, prefer official end-of-day values over live after the close.
- Unreliable GitHub cron: Vercel Cron dispatch + backup schedule + push retry when two refreshes overlap.
- Symbol changes (ICICIPRULI -> ICICILIFE) and trade-for-trade series (HFCL) in the instrument map, refreshed daily.

## 6. Numbers
- 259 stocks, 207 option chains, 13 sheet tabs, ~5 s or tick-level price latency, 2-minute indicators, 5-minute live OI.
- 52 automated tests; end-to-end checks on desktop and phone against production.
- Hosting cost: free tiers (Vercel, GitHub Actions); Upstox data API free with a demat account.

## 7. Resume lines (pick and adapt)
- Built a **real-time NSE F&O trading dashboard** (React, Vite, Node serverless on Vercel) streaming **tick-by-tick prices over WebSocket with a custom Protocol Buffers decoder** for 259 stocks.
- Integrated the **Upstox trading API** (option chain, Greeks, market depth, intraday candles) with paced fan-out and fallbacks, refreshing **207 option chains in ~9 s within a 30 s serverless limit**.
- Wrote a **Python / pandas data pipeline** (GitHub Actions) computing 20+ technical indicators, **Black-Scholes implied volatility, max pain, PCR** and futures build-up from NSE public data.
- Replaced a client's Google Sheets scanner with a **mobile-first web app** (13 sheet views, live alerts, TradingView charts), verified **100% price accuracy against NSE official files**.
- Added **walk-forward backtesting**, automated **unit + Puppeteer end-to-end tests**, and **scheduled production monitoring** with zero hosting cost.
