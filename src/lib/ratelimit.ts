/** Best-effort, in-memory limit for live AI calls on a public demo. Resets when the server restarts. */
const hits = new Map<string, number[]>();

export function allow(key: string, perHour: number, now = Date.now()): boolean {
  const since = now - 3600_000;
  const list = (hits.get(key) ?? []).filter((t) => t > since);
  if (list.length >= perHour) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
