import { describe, expect, it } from 'vitest';

import {
  LAST_LANTERN,
  createLastLanternState,
  replayLastLantern,
  type LanternEvidence,
} from '../shared/atlas/adventures/last-lantern';

const verifiedEvidence: LanternEvidence = {
  txHash: 'a'.repeat(64),
  network: 'testalbatross',
  recipient: LAST_LANTERN.recipient,
  valueLuna: LAST_LANTERN.priceLuna,
  canonical: true,
  success: true,
  confirmations: LAST_LANTERN.minimumConfirmations,
};

describe('The Last Lantern local vertical slice', () => {
  it('accepts the configured 0.1 NIM live order and still rejects mismatched evidence', () => {
    const state = createLastLanternState('explorer', 'live');
    const request = { ...LAST_LANTERN.request, recipient: 'NQ22EY1GT6FH5X60JGQQ6MK7H973T31PMYV4', valueLuna: 10_000 };
    replayLastLantern([{ type: 'enter-shop' }, { type: 'select-lantern' }, { type: 'review-request', request }], state);
    const evidence = { ...verifiedEvidence, recipient: request.recipient, valueLuna: request.valueLuna };
    expect(() => replayLastLantern([{ type: 'receive-evidence', source: 'server-verified', evidence: { ...evidence, valueLuna: 100_000 } }], state)).toThrow(/amount/i);
    expect(() => replayLastLantern([{ type: 'receive-evidence', source: 'local-simulation', evidence }], state)).toThrow(/server/i);
    expect(state.phase).toBe('review');
    replayLastLantern([
      { type: 'receive-evidence', source: 'server-verified', evidence },
      { type: 'fulfill-lantern' }, { type: 'reach-tower' },
    ], state);
    expect(state.phase).toBe('tower-lit');
  });

  it.each([0, -1, 0.1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid live Luna amount %s', (valueLuna) => {
    const state = createLastLanternState('explorer', 'live');
    replayLastLantern([{ type: 'enter-shop' }, { type: 'select-lantern' }], state);
    expect(() => replayLastLantern([{ type: 'review-request', request: { ...LAST_LANTERN.request, recipient: 'NQ22EY1GT6FH5X60JGQQ6MK7H973T31PMYV4', valueLuna } }], state)).toThrow(/amount/i);
    expect(state.phase).toBe('selected');
  });

  it('replays shop, review, simulated verification, carry, and harbor lighting', () => {
    const result = replayLastLantern([
      { type: 'enter-shop' },
      { type: 'select-lantern' },
      { type: 'review-request', request: { ...LAST_LANTERN.request } },
      { type: 'receive-evidence', evidence: verifiedEvidence, source: 'local-simulation' },
      { type: 'fulfill-lantern' },
      { type: 'reach-tower' },
    ]);
    expect(result.phase).toBe('tower-lit');
    expect(result.inventoryItemIds).toEqual(['harbor-lantern']);
    expect(result.world).toEqual({ lightsOn: true, ferriesRunning: true, npcSchedule: 'market-open', music: 'harbor-theme', pathsOpen: true });
  });

  it('rejects wrong recipient, network, Luna amount, and unconfirmed evidence', () => {
    const state = createLastLanternState('explorer', 'practice');
    replayLastLantern([{ type: 'enter-shop' }, { type: 'select-lantern' }], state);
    expect(() => replayLastLantern([{ type: 'review-request', request: { ...LAST_LANTERN.request, recipient: 'NQWRONG' } }], state)).toThrow(/recipient/i);
    expect(() => replayLastLantern([{ type: 'review-request', request: { ...LAST_LANTERN.request, network: 'mainalbatross' } }], state)).toThrow(/network/i);
    expect(() => replayLastLantern([{ type: 'review-request', request: { ...LAST_LANTERN.request, valueLuna: 1 } }], state)).toThrow(/Luna|amount/i);
    replayLastLantern([{ type: 'review-request', request: { ...LAST_LANTERN.request } }], state);
    expect(() => replayLastLantern([{ type: 'receive-evidence', evidence: { ...verifiedEvidence, confirmations: 0 }, source: 'local-simulation' }], state)).toThrow(/confirm/i);
    expect(state.phase).toBe('confirming');
  });

  it('fulfills exactly once and refuses browser-injected completion in competitive play', () => {
    const state = createLastLanternState('builder', 'practice');
    replayLastLantern([
      { type: 'enter-shop' }, { type: 'select-lantern' }, { type: 'review-request', request: { ...LAST_LANTERN.request } },
      { type: 'receive-evidence', evidence: verifiedEvidence, source: 'local-simulation' }, { type: 'fulfill-lantern' },
    ], state);
    expect(() => replayLastLantern([{ type: 'fulfill-lantern' }], state)).toThrow(/once|duplicate/i);

    const competitive = createLastLanternState('explorer', 'competitive');
    replayLastLantern([{ type: 'enter-shop' }, { type: 'select-lantern' }, { type: 'review-request', request: { ...LAST_LANTERN.request } }], competitive);
    expect(() => replayLastLantern([{ type: 'receive-evidence', evidence: verifiedEvidence, source: 'local-simulation' }], competitive)).toThrow(/server|competitive/i);
  });

  it('accepts a configured real testnet recipient only with server-verified evidence', () => {
    const recipient = `NQ00${'A'.repeat(32)}`;
    const live = createLastLanternState('explorer', 'live');
    const evidence = { ...verifiedEvidence, recipient };
    replayLastLantern([
      { type: 'enter-shop' }, { type: 'select-lantern' },
      { type: 'review-request', request: { ...LAST_LANTERN.request, recipient } },
    ], live);
    expect(() => replayLastLantern([{ type: 'receive-evidence', evidence, source: 'local-simulation' }], live)).toThrow(/server|verified/i);
    replayLastLantern([{ type: 'receive-evidence', evidence, source: 'server-verified' }], live);
    expect(live.phase).toBe('verified');
  });

  it('moves a submitted provider lookup into a confirmation wait without unlocking the harbor', () => {
    const state = createLastLanternState('explorer', 'live');
    replayLastLantern([{ type: 'enter-shop' }, { type: 'select-lantern' }, { type: 'review-request', request: { ...LAST_LANTERN.request, recipient: `NQ00${'A'.repeat(32)}` } }, { type: 'await-evidence' }], state);
    expect(state.phase).toBe('confirming');
    expect(state.inventoryItemIds).toEqual([]);
    expect(state.world.lightsOn).toBe(false);
  });
});
