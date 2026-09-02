import { describe, expect, it } from 'vitest';

import { ATLAS_DISTRICT_WORLDS } from '../shared/atlas/districts/registry';

const CASCADE_SCALES = ['payment', 'lookup', 'block', 'consensus', 'proof', 'authority', 'composition'] as const;

describe('Atlas district registry', () => {
  it('lists all seven districts exactly once, in cascade order', () => {
    expect(ATLAS_DISTRICT_WORLDS.map((world) => world.districtId)).toEqual([
      'genesis-garden',
      'pay-harbor',
      'albatross-causeway',
      'validator-peaks',
      'light-forest',
      'builder-city',
      'beacon-core',
    ]);
  });

  it('gives every district a mission whose districtId agrees with the world', () => {
    for (const world of ATLAS_DISTRICT_WORLDS) {
      expect(world.mission.districtId, `district ${world.districtId}`).toBe(world.districtId);
    }
  });
});

describe('Atlas readiness cascade', () => {
  it('covers every scale exactly once', () => {
    const scales = ATLAS_DISTRICT_WORLDS.map((world) => world.chapter.scale);
    expect(scales).toHaveLength(CASCADE_SCALES.length);
    expect(new Set(scales).size).toBe(CASCADE_SCALES.length);
    for (const scale of CASCADE_SCALES) expect(scales).toContain(scale);
  });

  it('assigns the scales in rung order', () => {
    expect(ATLAS_DISTRICT_WORLDS.map((world) => world.chapter.scale)).toEqual([...CASCADE_SCALES]);
  });

  it('gives every district a claim, a refutation and an evidence line', () => {
    for (const world of ATLAS_DISTRICT_WORLDS) {
      expect(world.chapter.claim.length, `claim for ${world.districtId}`).toBeGreaterThan(15);
      expect(world.chapter.refutation.length, `refutation for ${world.districtId}`).toBeGreaterThan(15);
      expect(world.chapter.evidence.length, `evidence for ${world.districtId}`).toBeGreaterThan(15);
    }
  });

  it('does not restate one lesson across districts', () => {
    // Each of these phrases used to describe a different district's teach-back,
    // which is what made seven districts read as one district with seven
    // backdrops. The district names promised Albatross, validators and light
    // clients while the writing delivered the payment lesson every time.
    const teachBacks = ATLAS_DISTRICT_WORLDS.map((world) => world.chapter.teachBack.toLowerCase());
    const overusedPhrases = ['wallet response', 'returned lookup', 'authoritative source', 'server-verified unlock'];
    for (const phrase of overusedPhrases) {
      expect(teachBacks.filter((teachBack) => teachBack.includes(phrase)), `phrase "${phrase}"`).toHaveLength(0);
    }
  });

  it('names its own rung concept in each teach-back', () => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['genesis-garden', 'approval'],
      ['pay-harbor', 'hash'],
      ['albatross-causeway', 'macro block'],
      ['validator-peaks', 'two thirds'],
      ['light-forest', 'proof'],
      ['builder-city', 'authority'],
      ['beacon-core', 'seal'],
    ];
    for (const [districtId, term] of expected) {
      const world = ATLAS_DISTRICT_WORLDS.find((candidate) => candidate.districtId === districtId);
      expect(world, `missing district ${districtId}`).toBeDefined();
      expect(world?.chapter.teachBack.toLowerCase(), `teach-back for ${districtId}`).toContain(term);
    }
  });
});
