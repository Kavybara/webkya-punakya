/**
 * Fixed-window attempt counter shared by the unauthenticated endpoints.
 *
 * Windows are per key, never global: one caller exhausting its budget must not
 * lock out anyone else. Entries are dropped lazily on read and on write, so a
 * scan of abandoned keys does not accumulate.
 */
export function createAttemptLimiter({
  maxAttempts,
  windowMs,
  now = Date.now,
  minWindowMs = 1_000,
} = {}) {
  const attempts = new Map();
  const limit = Math.max(1, Number(maxAttempts) || 1);
  const window = Math.max(minWindowMs, Number(windowMs) || 15 * 60 * 1000);
  const clock = typeof now === "function" ? now : Date.now;

  function activeAttempt(key) {
    const current = attempts.get(key);
    const timestamp = clock();
    if (!current || current.resetAt <= timestamp) {
      if (current) attempts.delete(key);
      return null;
    }
    return current;
  }

  return {
    check(key) {
      const current = activeAttempt(key);
      if (!current || current.count < limit) {
        return { allowed: true, remaining: limit - (current?.count || 0) };
      }
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - clock()) / 1_000)),
      };
    },
    recordFailure(key) {
      const timestamp = clock();
      const current = activeAttempt(key);
      attempts.set(key, current
        ? { ...current, count: current.count + 1 }
        : { count: 1, resetAt: timestamp + window });
    },
    clear(key) {
      attempts.delete(key);
    },
    limits: { maxAttempts: limit, windowMs: window },
  };
}
