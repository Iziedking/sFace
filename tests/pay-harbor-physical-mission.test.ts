import { describe, expect, it } from 'vitest';
import { createLastLanternState, replayLastLantern } from '../shared/atlas/adventures/last-lantern';
import { projectPayHarborPhysicalMission } from '../shared/atlas/city/pay-harbor-mission';

describe('Pay Harbor physical mission projection', () => {
  it('moves the Explorer through real anchors without changing payment authority', () => {
    const state = createLastLanternState('explorer', 'practice');
    expect(projectPayHarborPhysicalMission(state)).toMatchObject({ targetAnchorId: 'mara-harbor-keeper', actionLabel: 'Talk', restoration: 'waiting' });

    replayLastLantern([{ type: 'enter-shop' }], state);
    expect(projectPayHarborPhysicalMission(state)).toMatchObject({ targetAnchorId: 'lantern-counter', actionLabel: 'Inspect' });

    replayLastLantern([{ type: 'select-lantern' }], state);
    expect(projectPayHarborPhysicalMission(state)).toMatchObject({ targetAnchorId: 'payment-review', actionLabel: 'Review' });

    replayLastLantern([{ type: 'review-request', request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000 } }], state);
    expect(projectPayHarborPhysicalMission(state)).toMatchObject({ targetAnchorId: 'payment-review', actionLabel: 'Confirm practice' });
  });

  it('maps confirming and restored authority to visible district states', () => {
    const state = createLastLanternState('explorer', 'practice');
    replayLastLantern([
      { type: 'enter-shop' },
      { type: 'select-lantern' },
      { type: 'review-request', request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000 } },
      { type: 'await-evidence' },
    ], state);
    expect(projectPayHarborPhysicalMission(state).restoration).toBe('confirming');

    replayLastLantern([
      { type: 'receive-evidence', source: 'local-simulation', evidence: { txHash: 'practice', network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } },
      { type: 'fulfill-lantern' },
      { type: 'reach-tower' },
    ], state);
    expect(projectPayHarborPhysicalMission(state)).toMatchObject({ targetAnchorId: 'beacon-return-gate', actionLabel: 'Return', restoration: 'restored', complete: true });
  });

  it('routes a Builder through all six physical relay stations', () => {
    const state = createLastLanternState('builder', 'practice');
    replayLastLantern([
      { type: 'enter-shop' },
      { type: 'select-lantern' },
      { type: 'review-request', request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000 } },
      { type: 'receive-evidence', source: 'local-simulation', evidence: { txHash: 'builder-practice', network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } },
      { type: 'fulfill-lantern' },
    ], state);

    for (let index = 0; index < 6; index += 1) {
      expect(projectPayHarborPhysicalMission(state, index)).toMatchObject({ targetAnchorId: `station-${index + 1}-install`, actionLabel: `Install ${index + 1}/6` });
    }
    expect(projectPayHarborPhysicalMission(state, 6)).toMatchObject({ targetAnchorId: 'celebration-harbor-tower', actionLabel: 'Light tower' });
  });
});
