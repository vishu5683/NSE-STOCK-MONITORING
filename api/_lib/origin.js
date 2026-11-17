// A browser POST always carries Origin, so another site's page cannot drive these endpoints.
// ALLOWED_ORIGINS (comma list) adds hosts beyond this deployment's own, e.g. the GitHub Pages copy.
export function originAllowed(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === req.headers?.host) return true;
  const extra = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return extra.some((h) => h === host || h === origin);
}
