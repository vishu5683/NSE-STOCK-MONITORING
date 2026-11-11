# NSE Stocks Pro

Free, static NSE F&O stock screener and market dashboard. React + Vite front end, a small Python script for data, free hosting on GitHub Pages or Vercel. No server, no paid API, no database.

**Features**
- Dashboard: NIFTY, BANK NIFTY, SENSEX, India VIX, market breadth, sector heatmap, top setups, gainers/losers, volume spikes, closest to 52-week high
- Screener: 259 F&O stocks, presets, search, sector filter, sortable, watchlist, stock detail with chart and ATR-based trade idea
- Reports: styled Excel workbook (7 sheets with a Guide), PDF (client-ready), CSV
- Admin panel (password gate): branding, rule presets with live preview and validation, hidden stocks, watchlist, data health, settings backup
- Monitoring: data health checks on every refresh, warning banners on the site, GitHub issue + email when a refresh fails
- Dark and light theme, phone layout with bottom navigation, installable (Add to Home Screen)

## Run locally
```bash
npm install
pip install -r data-pipeline/requirements.txt
npm run data      # downloads fresh prices into public/data/latest.json (about 1 minute)
npm run dev       # http://localhost:5173
```

## Admin
Open the **Admin** tab. Password: password `Vishu@4321` (no username) (change in `src/lib/auth.js`). The whole site opens on this login screen.
This is a client-side gate only. See `PROJECT_NOTES.md` for what that means.

## Data
`data-pipeline/fetch_data.py` reads `data-pipeline/universe.csv`, downloads daily candles from Yahoo Finance (delayed, unofficial) and computes RSI, EMA 20/50/200, MACD, ADX, ATR, volume spike and 52-week range. The site never calls Yahoo directly; it only reads `public/data/latest.json`.

No live option chain and no intraday VWAP: there is no free reliable source, so those are not shown instead of being faked.

## Deploy (free)
**GitHub Pages**
1. Create a GitHub repo and push this folder to the `main` branch.
2. Settings > Pages > Source: **GitHub Actions**.
3. Actions > "Update data and deploy" > Run workflow. It also runs by itself every weekday (11:15, 13:30 and 16:00 IST).

**Vercel**
1. Import the same GitHub repo in Vercel. Framework: Vite (detected from `vercel.json`).
2. The workflow commits fresh `public/data/latest.json` after each refresh, and Vercel redeploys automatically.

## Live prices (production, free)
GitHub Pages is static, so it can only show the daily data. For **live prices** deploy on Vercel (free). It runs a small backend in `api/` that keeps the Upstox token on the server and gives prices only to signed-in visitors.

1. Upstox: Developer Apps > your app > **Analytics** tab > generate the **Analytics Token** (read-only, valid 1 year, no static IP needed for market data). Only one is active per account; generating a new one revokes the old one.
2. Vercel: New Project > import this GitHub repo. In Settings > Environment Variables add `UPSTOX_ANALYTICS_TOKEN`, `SITE_PASSWORD` (the client's sign-in password) and `SESSION_SECRET` (long random text, see `.env.example`). Deploy.
3. Open the site, sign in. The top bar changes to "Upstox live", prices refresh every 5 seconds during market hours (every 60 seconds otherwise).
4. Once a year: generate a new Analytics Token and update `UPSTOX_ANALYTICS_TOKEN`. If it is rejected, the site shows "Live prices paused" and keeps the daily data.

Without those variables (or on GitHub Pages) the site works exactly as before on daily data.
Run `npm test` before deploying. `npm run instruments` rebuilds the symbol to Upstox key map after you add stocks to `universe.csv`.

## Change the client name, colours, thresholds for everyone
Admin > Export settings, paste the JSON into `public/config.json`, commit and push.

## Disclaimer
Rule-based research output only. Not investment advice.
