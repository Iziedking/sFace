import { describe, expect, it } from 'vitest';
import { getAtlasWaypointGuidance } from '../shared/atlas/city/wayfinding';

describe('Atlas city wayfinding', () => {
  const player = { x: 0, z: 0, headingRadians: Math.PI };

  it('reports a nearby interaction target as ready', () => {
    expect(getAtlasWaypointGuidance(player, { x: 0, z: -2 })).toMatchObject({ direction: 'ready', arrow: '•' });
  });

  it('turns the map target into camera-relative guidance', () => {
    expect(getAtlasWaypointGuidance(player, { x: 0, z: -8 })).toMatchObject({ direction: 'ahead', arrow: '↑' });
    expect(getAtlasWaypointGuidance(player, { x: 8, z: 0 })).toMatchObject({ direction: 'right', arrow: '↗' });
    expect(getAtlasWaypointGuidance(player, { x: -8, z: 0 })).toMatchObject({ direction: 'left', arrow: '↖' });
    expect(getAtlasWaypointGuidance(player, { x: 0, z: 8 })).toMatchObject({ direction: 'behind', arrow: '↓' });
  });
});
