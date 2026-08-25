import { describe, expect, it } from 'vitest';

import {
  assertManifestSupersedes,
  canonicalJson,
  createPublishedManifest,
  verifyPublishedManifest,
} from '../shared/atlas/content-hash';
import { ATLAS_CAMPAIGN_CONTENT } from '../shared/atlas/manifests';

describe('NIM Atlas content versioning', () => {
  it('hashes equivalent object key order identically', async () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    const first = await createPublishedManifest('campaign', 2, '2026-08-25', { b: 2, a: 1 });
    const second = await createPublishedManifest('campaign', 2, '2026-08-25', { a: 1, b: 2 });
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('rejects content hash drift and stale review dates', async () => {
    const manifest = await createPublishedManifest('campaign', 2, '2026-08-25', ATLAS_CAMPAIGN_CONTENT);
    const drifted = { ...manifest, content: { ...manifest.content, title: 'changed' } };
    await expect(verifyPublishedManifest(drifted, new Date('2026-08-25T12:00:00.000Z'))).rejects.toThrow(/hash/i);
    await expect(verifyPublishedManifest({ ...manifest, reviewedAt: '2025-01-01' }, new Date('2026-08-25T12:00:00.000Z'))).rejects.toThrow(/stale/i);
  });

  it('requires a superseding version for a correction', async () => {
    const original = await createPublishedManifest('campaign', 2, '2026-08-25', ATLAS_CAMPAIGN_CONTENT);
    const sameVersion = { ...original, contentHash: 'f'.repeat(64) };
    expect(() => assertManifestSupersedes(original, sameVersion)).toThrow(/immutable|supersed/i);
    const correction = await createPublishedManifest('campaign', 3, '2026-08-25', { ...ATLAS_CAMPAIGN_CONTENT, title: 'Corrected Atlas' }, original.contentHash);
    expect(() => assertManifestSupersedes(original, correction)).not.toThrow();
  });
});
