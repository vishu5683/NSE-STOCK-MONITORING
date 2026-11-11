import { send } from './_lib/http.js';
import { configured, loginRequired } from './_lib/auth.js';
import { stats } from './_lib/upstox.js';

// Lets the website discover whether the live backend exists. No secrets, no prices.
export default function handler(req, res) {
  send(res, 200, {
    ok: true,
    live: Boolean(process.env.UPSTOX_ANALYTICS_TOKEN),
    login: loginRequired() && configured(),
    instruments: stats,
  });
}
