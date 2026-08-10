export interface RateLimitBucket {
  tokens: number;
  updatedAt: number;
}

export function pruneRateLimitBuckets(
  buckets: Map<string, RateLimitBucket>,
  now: number,
  idleMs: number,
): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > idleMs) buckets.delete(key);
  }
}
