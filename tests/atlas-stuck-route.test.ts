import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ATLAS_DISTRICT_WORLDS } from '../shared/atlas/districts/registry';
import { atlasBeatRows, type AtlasMissionBeat } from '../shared/atlas/mission-director';

const harbor = ATLAS_DISTRICT_WORLDS.find((world) => world.districtId === 'pay-harbor')!;

const refused: AtlasMissionBeat = {
  kind: 'refused',
  scale: 'lookup',
  districtId: 'pay-harbor',
  headline: harbor.chapter.claim,
  detail: harbor.chapter.evidence,
  refusalReason: harbor.chapter.refutation,
};

describe('Atlas stuck-route panel rows', () => {
  it('reads claim, then refusal, then what would settle it', () => {
    expect(atlasBeatRows(refused).map((row) => row.kind)).toEqual(['headline', 'refusal', 'detail']);
    expect(atlasBeatRows(refused).map((row) => row.text)).toEqual([harbor.chapter.claim, harbor.chapter.refutation, harbor.chapter.evidence]);
  });

  it('omits the refusal row when a beat has no refusal', () => {
    const teachBack: AtlasMissionBeat = { ...refused, kind: 'teach-back', refusalReason: null, headline: 'Teach it back', detail: harbor.chapter.teachBack };
    expect(atlasBeatRows(teachBack).map((row) => row.kind)).toEqual(['headline', 'detail']);
  });

  it('marks only the refusal as monospace, matching the rest of the product', () => {
    const mono = atlasBeatRows(refused).filter((row) => row.monospace);
    expect(mono).toHaveLength(1);
    expect(mono[0]!.kind).toBe('refusal');
  });

  it('produces rows for every district refusal without an empty line', () => {
    for (const world of ATLAS_DISTRICT_WORLDS) {
      const beat: AtlasMissionBeat = {
        kind: 'refused', scale: world.chapter.scale, districtId: world.districtId,
        headline: world.chapter.claim, detail: world.chapter.evidence, refusalReason: world.chapter.refutation,
      };
      for (const row of atlasBeatRows(beat)) {
        expect(row.text.trim().length, `${world.districtId} ${row.kind}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('Atlas stuck-route panel markup', () => {
  const toolkit = readFileSync(new URL('../src/atlas/ui/atlas-toolkit.ts', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');

  it('builds the panel from the pure rows rather than restating them', () => {
    expect(toolkit).toContain('atlasBeatRows(beat)');
    expect(toolkit).toContain('renderAtlasBeatPanel');
  });

  it('announces the refusal rather than relying on colour', () => {
    expect(toolkit).toContain("element.setAttribute('role', 'status')");
  });

  it('styles every row kind the rows can produce', () => {
    for (const kind of ['headline', 'refusal', 'detail']) {
      expect(css, `missing style for ${kind}`).toContain(`.atlas-beat-${kind}`);
    }
  });
});
