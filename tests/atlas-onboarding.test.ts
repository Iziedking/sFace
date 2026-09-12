import { describe, expect, it } from 'vitest';
import {
  ATLAS_FREE_PLAY_METRES,
  ATLAS_FREE_PLAY_SECONDS,
  atlasFreePlayComplete,
} from '../shared/atlas/city/onboarding';

const arriving = { chapter: 0, stage: 'arrive', actionsTaken: 0 };

describe('the opening minute', () => {
  it('holds the mission card back until the player has actually moved', () => {
    expect(atlasFreePlayComplete({ ...arriving, metresExplored: 0, secondsElapsed: 0 })).toBe(false);
    expect(atlasFreePlayComplete({ ...arriving, metresExplored: 3, secondsElapsed: 12 })).toBe(false);
    expect(atlasFreePlayComplete({ ...arriving, metresExplored: ATLAS_FREE_PLAY_METRES, secondsElapsed: 5 })).toBe(true);
  });

  it('starts anyway for a player who never moves', () => {
    // A gate with no timeout is indistinguishable from a broken build, and the
    // player who most needs the card is the one who cannot work the joystick.
    expect(atlasFreePlayComplete({ ...arriving, metresExplored: 0, secondsElapsed: ATLAS_FREE_PLAY_SECONDS })).toBe(true);
  });

  it('never makes a returning player wander for their card again', () => {
    const stationary = { metresExplored: 0, secondsElapsed: 0 };
    expect(atlasFreePlayComplete({ ...stationary, chapter: 0, stage: 'arrive', actionsTaken: 1 })).toBe(true);
    expect(atlasFreePlayComplete({ ...stationary, chapter: 0, stage: 'evidence', actionsTaken: 0 })).toBe(true);
    expect(atlasFreePlayComplete({ ...stationary, chapter: 3, stage: 'arrive', actionsTaken: 0 })).toBe(true);
  });

  it('shows the card rather than hiding it when there is no run at all', () => {
    expect(atlasFreePlayComplete({ metresExplored: 0, secondsElapsed: 0, chapter: null, stage: null, actionsTaken: 0 })).toBe(true);
  });

  it('fails open on nonsense input instead of sealing the game shut', () => {
    expect(atlasFreePlayComplete({ ...arriving, metresExplored: Number.NaN, secondsElapsed: 0 })).toBe(true);
    expect(atlasFreePlayComplete({ ...arriving, metresExplored: 0, secondsElapsed: Number.POSITIVE_INFINITY })).toBe(true);
  });
});
