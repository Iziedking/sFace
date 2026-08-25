import { describe, expect, it } from 'vitest';

import { createRelayShareCard } from '../src/relay/share/card';
import { createRelayMiniAppDeepLink, parseRelayMiniAppDeepLink } from '../src/relay/share/deeplink';

describe('Relay public sharing', () => {
  it('creates a personal proof only from verified public fields', () => {
    const card = createRelayShareCard({
      variant: 'personal-proof',
      verified: true,
      missionDate: '2026-08-24',
      score: 240,
      completedTicks: 1_350,
      repairUnits: 12,
    });
    expect(card.text).toContain('240 repair points');
    expect(card.text).toContain('2026-08-24');
    expect(card.svg).toContain('240 repair points');
    expect(card.text).not.toContain('NQ');
    expect(() => createRelayShareCard({
      variant: 'personal-proof', verified: false, missionDate: '2026-08-24', score: 240, completedTicks: 1_350, repairUnits: 12,
    })).toThrow('verified');
  });

  it('derives community copy from the current world response', () => {
    const card = createRelayShareCard({
      variant: 'community-deficit',
      verified: true,
      missionDate: '2026-08-24',
      score: 1,
      completedTicks: 1,
      repairUnits: 1,
      world: { repairTotal: 250, target: 1_000 },
    });
    expect(card.text).toContain('750 repair units left');
  });

  it('creates and validates a Nimiq Pay mini-app link while ignoring unknown parameters', () => {
    const link = createRelayMiniAppDeepLink('https://sface.site', '2026-08-24', 'run-123');
    expect(link.startsWith('nimiqpay://miniapp?url=')).toBe(true);
    expect(parseRelayMiniAppDeepLink(`${link}&ignored=1`)).toEqual({ missionDate: '2026-08-24', replayId: 'run-123' });
    expect(parseRelayMiniAppDeepLink('nimiqpay://miniapp?url=https%3A%2F%2Fsface.site%2F%3FmissionDate%3Dbad')).toBeNull();
  });
});
