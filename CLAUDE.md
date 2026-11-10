# NSE Stocks Pro (personal freelance project)

Read `PROJECT_NOTES.md` first. It has the goal, status, structure, data limits, rules and deploy steps.

Rules for this folder:
- This is a personal project, separate from the TCI Freight repos. Do not copy anything into TCI Freight.
- Reply to the user in Hinglish, short.
- Everything must stay free (no paid APIs or hosting).
- Never fake data. If a value cannot be fetched, show "-" or a warning. Do not show invented PCR, OI or option prices.
- The admin password is a client-side gate only. Never store real secrets in the front end.
- Commit or push only when the user asks.
- Verify UI changes in a real browser (headless Edge with puppeteer-core works on this machine) and run `npm run build` before saying done.
