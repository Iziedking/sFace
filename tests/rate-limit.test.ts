import { describe, expect, it } from 'vitest';

import { pruneRateLimitBuckets, type RateLimitBucket } from '../server/rate-limit';

describe('rate-limit bucket cleanup', () => {
  it('removes idle buckets and keeps recently used buckets', () => {
    const buckets = new Map<string, RateLimitBucket>([
      ['old', { tokens: 1, updatedAt: 1_000 }],
      ['recent', { tokens: 1, updatedAt: 9_500 }],
    ]);

    pruneRateLimitBuckets(buckets, 10_000, 2_000);

    expect([...buckets.keys()]).toEqual(['recent']);
  });
});
