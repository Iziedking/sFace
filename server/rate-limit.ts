import type { NextFunction, Request, Response } from 'express';

export interface RateLimitBucket { tokens: number; updatedAt: number; }

export function pruneRateLimitBuckets(buckets: Map<string, RateLimitBucket>, now: number, idleMs: number): void {
  for (const [key, bucket] of buckets) if (now - bucket.updatedAt > idleMs) buckets.delete(key);
}

export function createRateLimiter() {
  const buckets = new Map<string, RateLimitBucket>();
  let lastSweep = 0;
  return {
    count: () => buckets.size,
    limit(perMinute: number, burst: number) {
      const refillPerMs = perMinute / 60_000;
      return (req: Request, res: Response, next: NextFunction): void => {
        const key = `${req.method}:${req.path}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
        const now = Date.now();
        if (now - lastSweep >= 60_000) {
          pruneRateLimitBuckets(buckets, now, 10 * 60_000);
          lastSweep = now;
        }
        const bucket = buckets.get(key) ?? { tokens: burst, updatedAt: now };
        bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
        bucket.updatedAt = now;
        if (bucket.tokens < 1) {
          buckets.set(key, bucket);
          res.status(429).json({ error: 'Too many requests. Slow down.' });
          return;
        }
        bucket.tokens -= 1;
        buckets.set(key, bucket);
        next();
      };
    },
  };
}
