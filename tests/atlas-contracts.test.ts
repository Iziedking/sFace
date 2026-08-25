import { describe, expect, it } from 'vitest';

import { atlasCurriculumSchema } from '../shared/atlas/curriculum';
import { createAtlasManifestBundle } from '../shared/atlas/manifests';
import { validatePublishedManifest } from '../shared/atlas/content-hash';

describe('NIM Atlas versioned content contracts', () => {
  it('publishes the evergreen campaign, adventure, Knowledge, season, and shop manifests', async () => {
    const bundle = await createAtlasManifestBundle();
    expect(bundle.map((manifest) => manifest.kind)).toEqual(['campaign', 'adventure', 'knowledge', 'season', 'shop']);
    for (const manifest of bundle) {
      expect(manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(() => validatePublishedManifest(manifest)).not.toThrow();
    }
  });

  it('rejects duplicate IDs and an enabled mainnet operation without an owner gate', async () => {
    const bundle = await createAtlasManifestBundle();
    const knowledge = bundle.find((manifest) => manifest.kind === 'knowledge');
    expect(knowledge).toBeDefined();
    const duplicate = structuredClone(knowledge!);
    const fragments = duplicate.content as { fragments: Array<{ id: string }> };
    fragments.fragments.push({ ...fragments.fragments[0]! });
    expect(() => validatePublishedManifest(duplicate)).toThrow(/duplicate/i);

    const curriculum = structuredClone((await import('../shared/atlas/manifest')).ATLAS_CURRICULUM);
    const trial = curriculum.districts[0]!.trials[0]!;
    (trial as { capability: string }).capability = 'mainnet-send';
    trial.enabled = true;
    trial.ownerGate = false;
    expect(() => atlasCurriculumSchema.parse(curriculum)).toThrow(/mainnet|gate/i);

    const shop = bundle.find((manifest) => manifest.kind === 'shop');
    expect(shop).toBeDefined();
    const unsafeShop = structuredClone(shop!);
    const items = unsafeShop.content as { items: Array<{ enabled: boolean; ownerGate: boolean }> };
    items.items[0]!.enabled = true;
    items.items[0]!.ownerGate = false;
    expect(() => validatePublishedManifest(unsafeShop)).toThrow(/mainnet|gate/i);
  });
});
