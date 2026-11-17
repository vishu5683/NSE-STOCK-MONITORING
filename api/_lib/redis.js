// Upstash Redis over its REST API (no client library, works on Vercel functions).
//
// UPSTASH_REDIS_REST_URL    https://<name>.upstash.io
// UPSTASH_REDIS_REST_TOKEN  REST token from the Upstash console

export function redisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function call(path, body) {
  const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(`Redis HTTP ${res.status}`);
  return json;
}

// redis('HGET', 'key', 'field') -> result
export async function redis(...cmd) {
  const json = await call('', cmd);
  if (json.error) throw new Error(`Redis: ${json.error}`);
  return json.result;
}

// pipeline([['HSET', ...], ['EXPIRE', ...]]) -> [result, ...]
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  const json = await call('/pipeline', cmds);
  return json.map((r) => {
    if (r.error) throw new Error(`Redis: ${r.error}`);
    return r.result;
  });
}

// HGETALL comes back as a flat [field, value, field, value] list.
export const pairsToObject = (arr) => {
  const out = {};
  for (let i = 0; i + 1 < (arr || []).length; i += 2) out[arr[i]] = arr[i + 1];
  return out;
};
