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
Open the **Admin** tab. Password: username `ADMIN`, password `Vishu@4321` (change in `src/lib/auth.js`). The whole site opens on this login screen.
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

## Change the client name, colours, thresholds for everyone
Admin > Export settings, paste the JSON into `public/config.json`, commit and push.

## Disclaimer
Rule-based research output only. Not investment advice.
