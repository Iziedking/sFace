import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAY_HARBOR_CITY } from '../shared/atlas/city/pay-harbor';
import { parseAtlasCityScene } from '../shared/atlas/city/types';

describe('Pay Harbor 3D district', () => {
  it('contains every physical Last Lantern step', () => {
    const ids = new Set(PAY_HARBOR_CITY.anchors.map((anchor) => anchor.id));
    for (const id of [
      'arrival-dock', 'mara-harbor-keeper', 'lantern-counter', 'payment-review', 'relay-pickup',
      'station-1-install', 'station-2-install', 'station-3-install', 'station-4-install',
      'station-5-install', 'station-6-install', 'builder-workbench', 'ferry-boarding', 'beacon-return-gate',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('keeps the generated district scene aligned with the shared contract', () => {
    const generated = parseAtlasCityScene(JSON.parse(readFileSync('public/atlas/3d/v1/pay-harbor/scene.json', 'utf8')));
    expect(generated.districtId).toBe(PAY_HARBOR_CITY.districtId);
    expect(generated.anchors.filter((anchor) => anchor.id.startsWith('station-')).length).toBe(6);
    expect(generated.anchors.filter((anchor) => anchor.id.startsWith('npc-spawn-')).length).toBeGreaterThanOrEqual(12);
    expect(generated.paths.filter((path) => path.purpose === 'queue')).toHaveLength(2);
    expect(generated.paths).toHaveLength(5);
  });

  it('uses the same restoration state for Explorer and Builder semantics', () => {
    const required = new Set(PAY_HARBOR_CITY.anchors.filter((anchor) => anchor.kind === 'install').map((anchor) => anchor.id));
    expect(required).toEqual(new Set([
      'station-1-install', 'station-2-install', 'station-3-install',
      'station-4-install', 'station-5-install', 'station-6-install', 'celebration-harbor-tower',
    ]));
    expect(PAY_HARBOR_CITY.paths.find((path) => path.id === 'restoration-loop')?.purpose).toBe('celebration');
  });
});
