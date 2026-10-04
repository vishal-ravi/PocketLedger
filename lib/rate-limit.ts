/**
 * In-memory sliding-window rate limiter + failure lockout.
 *
 * Process-local: correct for a single Node instance (this app's deployment model).
 * If you scale to multiple instances, back this with Redis or similar.
 */

type Window = {hits: number[]};

const windows = new Map<string, Window>();
const failures = new Map<string, number[]>();

const MAX_KEYS = 10_000;

function prune(list: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  let start = 0;
  while (start < list.length && list[start] < cutoff) start++;
  return start > 0 ? list.slice(start) : list;
}

function evictIfFull(map: Map<string, unknown>): void {
  if (map.size <= MAX_KEYS) return;
  // Maps iterate in insertion order; drop the oldest quarter.
  let toDrop = Math.floor(map.size / 4);
  for (const key of map.keys()) {
    map.delete(key);
    if (--toDrop <= 0) break;
  }
}

export type LimitResult = {ok: boolean; remaining: number; retryAfter: number};

/** Record an attempt against `key`. Returns ok=false (with retryAfter seconds) once over the limit. */
export function hit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  const entry = windows.get(key) ?? {hits: []};
  entry.hits = prune(entry.hits, windowMs, now);

  if (entry.hits.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.hits[0] + windowMs - now) / 1000));
    windows.set(key, entry);
    return {ok: false, remaining: 0, retryAfter};
  }
  entry.hits.push(now);
  if (!windows.has(key)) evictIfFull(windows);
  windows.set(key, entry);
  return {ok: true, remaining: limit - entry.hits.length, retryAfter: 0};
}

/**
 * Record a failed attempt (e.g. bad password). Once `max` failures land inside `windowMs`,
 * the key is locked for `lockMs`. Returns the current lock state.
 */
export function failHit(key: string, max: number, windowMs: number, lockMs: number): {locked: boolean; retryAfter: number} {
  const now = Date.now();
  const list = prune(failures.get(key) ?? [], windowMs, now);
  list.push(now);
  if (!failures.has(key)) evictIfFull(failures);
  failures.set(key, list);

  if (list.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((list[0] + lockMs - now) / 1000));
    return {locked: true, retryAfter};
  }
  return {locked: false, retryAfter: 0};
}

/** Is this key currently locked? Does not record a new failure. */
export function isLocked(key: string, max: number, windowMs: number, lockMs: number, at: number = Date.now()): boolean {
  const list = prune(failures.get(key) ?? [], windowMs, at);
  if (list.length < max) return false;
  return list[list.length - max] + lockMs > at;
}

/** Clear failure state (successful login). */
export function reset(key: string): void {
  failures.delete(key);
  windows.delete(key);
}

/** Test helper: wipe all state. */
export function _resetAll(): void {
  windows.clear();
  failures.clear();
}

/** Client IP for rate-limit keys (first hop of x-forwarded-for, or 'local'). */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'local';
}
