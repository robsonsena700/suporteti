type RateLimitOptions = {
  windowMs: number;
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function createInMemoryRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, number[]>();

  const cleanup = (now: number) => {
    const cutoff = now - options.windowMs;
    for (const [key, times] of hits.entries()) {
      const filtered = times.filter((t) => t > cutoff);
      if (filtered.length === 0) hits.delete(key);
      else hits.set(key, filtered);
    }
  };

  return {
    check(key: string, now = Date.now()): RateLimitResult {
      cleanup(now);
      const cutoff = now - options.windowMs;
      const times = (hits.get(key) ?? []).filter((t) => t > cutoff);

      if (times.length >= options.max) {
        const oldest = times[0] ?? now;
        const retryAfterMs = Math.max(0, oldest + options.windowMs - now);
        return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
      }

      times.push(now);
      hits.set(key, times);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

