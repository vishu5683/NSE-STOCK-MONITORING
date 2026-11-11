import { send } from './_lib/http.js';

// Called by Vercel Cron (see "crons" in vercel.json). It asks GitHub to run the data workflow now.
// A workflow_dispatch starts right away, unlike GitHub's own schedule, which is often late or skipped.
// The workflow rebuilds public/data/*.json and commits them; the commit redeploys this site.
//
// Vercel env:
//   CRON_SECRET          any long random text. Vercel sends it as "Authorization: Bearer <CRON_SECRET>".
//   GH_DISPATCH_TOKEN    GitHub fine-grained token, this repo only, permission "Actions: Read and write".
const REPO = process.env.GH_REPO || 'vishu5683/NSE-STOCK-MONITORING';
const WORKFLOW = 'update-data-and-deploy.yml';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers?.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'UNAUTHORIZED', message: 'Only the scheduler may call this.' });
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) return send(res, 503, { error: 'NOT_CONFIGURED', message: 'GH_DISPATCH_TOKEN is not set on the server.' });
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nsestocks-cron' },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status === 204) return send(res, 200, { ok: true, dispatched: WORKFLOW, at: new Date().toISOString() });
    return send(res, 502, { error: 'GITHUB', message: `GitHub answered HTTP ${r.status}.` });
  } catch (err) {
    return send(res, 502, { error: 'GITHUB', message: `Could not reach GitHub. ${err.message}` });
  }
}
