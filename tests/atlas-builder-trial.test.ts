import { describe, expect, it } from 'vitest';

import { LAST_LANTERN } from '../shared/atlas/adventures/last-lantern';
import { gradeBuilderRepair, type BuilderRepairSubmission } from '../server/atlas/builder';

const validSubmission: BuilderRepairSubmission = {
  trialId: 'harbor-repair-v1',
  recipeVersion: 1,
  predictions: [
    { step: 'provider-init', prediction: 'provider-or-honest-unavailable' },
    { step: 'user-intent', prediction: 'accounts-only-after-player-choice' },
    { step: 'list-accounts', prediction: 'approved-address-list-or-rejection' },
    { step: 'prepare-payment', prediction: 'exact-testnet-request' },
    { step: 'wallet-result', prediction: 'lookup-only-until-chain-proof' },
    { step: 'chain-reconcile', prediction: 'confirming-until-three-confirmations' },
    { step: 'fulfillment', prediction: 'one-order-one-item' },
  ],
  operations: [
    { method: 'provider-init', args: { timeoutMs: 2_500 } },
    { method: 'request-user-intent', args: { purpose: 'harbor-lantern' } },
    { method: 'list-accounts', args: {} },
    { method: 'prepare-basic-payment', args: { network: 'testalbatross', recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna } },
    { method: 'send-basic-payment', args: { network: 'testalbatross', recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna } },
    { method: 'reconcile-chain', args: { minimumConfirmations: 3 } },
    { method: 'fulfill-order', args: { itemId: 'harbor-lantern' } },
  ],
  observations: {
    providerReady: true,
    accountIntentRequested: true,
    accountsListed: true,
    walletLookupReceived: true,
    chainVerified: true,
    orderFulfilled: true,
  },
};

describe('NIM Atlas Builder repair trial', () => {
  it('grades the complete predicted typed repair and unlocks the recipe', () => {
    expect(gradeBuilderRepair(validSubmission)).toEqual({ ok: true, recipeUnlocked: true, score: 100, errors: [] });
  });

  it('requires predictions before observations and preserves cancellation as a valid recovery path', () => {
    const missingPrediction = structuredClone(validSubmission);
    missingPrediction.predictions = missingPrediction.predictions.slice(1);
    expect(gradeBuilderRepair(missingPrediction)).toMatchObject({ ok: false, recipeUnlocked: false });

    const cancelled = structuredClone(validSubmission);
    cancelled.operations = cancelled.operations.slice(0, 5).concat({ method: 'wallet-cancelled', args: { recoverable: true } }, { method: 'retry-payment', args: { sameOrder: true } });
    cancelled.observations = { ...cancelled.observations, walletLookupReceived: false, chainVerified: false, orderFulfilled: false };
    expect(gradeBuilderRepair(cancelled)).toMatchObject({ ok: true, recipeUnlocked: true });
  });

  it('rejects arbitrary code, unknown methods or fields, mainnet sends, and stale recipes', () => {
    const arbitrary = structuredClone(validSubmission) as BuilderRepairSubmission & { code?: string };
    arbitrary.code = 'eval(input)';
    expect(gradeBuilderRepair(arbitrary)).toMatchObject({ ok: false });

    const unknownMethod = structuredClone(validSubmission);
    unknownMethod.operations[0] = { method: 'run-javascript', args: {} } as never;
    expect(gradeBuilderRepair(unknownMethod)).toMatchObject({ ok: false });

    const unknownField = structuredClone(validSubmission);
    unknownField.operations[0] = { method: 'provider-init', args: { timeoutMs: 2_500, secret: 'x' } } as never;
    expect(gradeBuilderRepair(unknownField)).toMatchObject({ ok: false });

    const mainnet = structuredClone(validSubmission);
    mainnet.operations[4] = { method: 'send-basic-payment', args: { network: 'mainalbatross', recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna } };
    expect(gradeBuilderRepair(mainnet)).toMatchObject({ ok: false });

    const stale = structuredClone(validSubmission);
    stale.recipeVersion = 0;
    expect(gradeBuilderRepair(stale)).toMatchObject({ ok: false });
  });
});
