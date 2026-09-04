import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { atlasCitizenDetailLevel } from '../src/atlas/render/three/character-animation';

const renderer = readFileSync(new URL('../src/atlas/render/three/three-renderer.ts', import.meta.url), 'utf8');

describe('Citizen level of detail', () => {
  it('does not flip back and forth at the threshold', () => {
    /*
     * The bug a playtester reported as "this double feel while humans walk".
     *
     * Each citizen owns two rigs and only the visible one is animated, so the
     * hidden one is frozen wherever it was last drawn. With a bare
     * `distance <= 12`, a citizen sitting at the boundary — and the player is
     * almost always moving, so several always are — swapped bodies every frame
     * and showed a different stride pose each time.
     */
    let level = atlasCitizenDetailLevel('balanced', false, 11.9, 'distant');
    expect(level).toBe('near');
    // Drifting just past the entry distance must not immediately undo it.
    level = atlasCitizenDetailLevel('balanced', false, 12.4, level);
    expect(level).toBe('near');
    level = atlasCitizenDetailLevel('balanced', false, 13.9, level);
    expect(level).toBe('near');
    // Only well clear of the band does it drop to the distant rig.
    level = atlasCitizenDetailLevel('balanced', false, 15.2, level);
    expect(level).toBe('distant');
    // And coming back needs the entry distance again, not the exit one.
    level = atlasCitizenDetailLevel('balanced', false, 13.0, level);
    expect(level).toBe('distant');
    level = atlasCitizenDetailLevel('balanced', false, 11.5, level);
    expect(level).toBe('near');
  });

  it('survives a citizen jittering across the old hard threshold', () => {
    // Twenty crossings of exactly 12 m used to mean twenty body swaps.
    let level: 'near' | 'distant' = 'distant';
    let switches = 0;
    for (let step = 0; step < 20; step += 1) {
      const distance = step % 2 === 0 ? 11.99 : 12.01;
      const next = atlasCitizenDetailLevel('balanced', false, distance, level);
      if (next !== level) switches += 1;
      level = next;
    }
    expect(switches, `${switches} body swaps while jittering at the boundary`).toBeLessThanOrEqual(1);
  });

  it('keeps the old behaviour where it was already right', () => {
    expect(atlasCitizenDetailLevel('low', false, 1, 'near')).toBe('distant');
    expect(atlasCitizenDetailLevel('balanced', true, 999, 'distant')).toBe('near');
    expect(atlasCitizenDetailLevel('high', false, 19, 'distant')).toBe('near');
    expect(atlasCitizenDetailLevel('high', false, 25, 'distant')).toBe('distant');
  });

  it('carries the stride across a swap so the rare switch is invisible', () => {
    // Hysteresis makes switches rare; this makes the rare ones seamless.
    expect(renderer).toContain('arriving.mixer.setTime(leaving.mixer.time)');
    expect(renderer).toContain('slot.detailLevel = detailLevel;');
  });

  it('passes the current level in, or hysteresis cannot work', () => {
    expect(renderer).toContain('atlasCitizenDetailLevel(this.qualityTier, citizen.active, distanceFromPlayer, slot.detailLevel)');
  });
});
