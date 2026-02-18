type Bucket = {
  count: number;
  startedAtMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function consumeFixedWindow(
  store: Map<string, Bucket>,
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const current = store.get(key);

  if (!current || now - current.startedAtMs >= windowMs) {
    store.set(key, { count: 1, startedAtMs: now });
    return {
      allowed: true,
      remaining: Math.max(0, max - 1),
      retryAfterSeconds: 0
    };
  }

  if (current.count >= max) {
    const retryMs = current.startedAtMs + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(Math.max(0, retryMs) / 1000)
    };
  }

  current.count += 1;
  store.set(key, current);
  return {
    allowed: true,
    remaining: Math.max(0, max - current.count),
    retryAfterSeconds: 0
  };
}
