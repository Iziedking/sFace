import { LAST_LANTERN } from '../../shared/atlas/adventures/last-lantern';
import { BUILDER_OPERATION_ORDER, BUILDER_RECIPE_VERSION, type BuilderOperation, type BuilderRepairSubmission } from '../../shared/atlas/builder-trial';

export type { BuilderRepairSubmission } from '../../shared/atlas/builder-trial';

export interface BuilderRepairResult {
  ok: boolean;
  recipeUnlocked: boolean;
  score: number;
  errors: string[];
}

const EXPECTED_PREDICTIONS = [
  ['provider-init', 'provider-or-honest-unavailable'],
  ['user-intent', 'accounts-only-after-player-choice'],
  ['list-accounts', 'approved-address-list-or-rejection'],
  ['prepare-payment', 'exact-testnet-request'],
  ['wallet-result', 'lookup-only-until-chain-proof'],
  ['chain-reconcile', 'confirming-until-three-confirmations'],
  ['fulfillment', 'one-order-one-item'],
] as const;

export function gradeBuilderRepair(value: unknown): BuilderRepairResult {
  const errors: string[] = [];
  if (!isRecord(value) || !exactKeys(value, ['trialId', 'recipeVersion', 'predictions', 'operations', 'observations'])) {
    return fail(['The repair payload has unknown or missing fields.']);
  }
  if (value.trialId !== 'harbor-repair-v1') errors.push('The repair recipe is not the current Builder trial.');
  if (value.recipeVersion !== BUILDER_RECIPE_VERSION) errors.push('The Builder recipe is stale.');
  if (!Array.isArray(value.predictions) || !matchesPredictions(value.predictions)) errors.push('Predict every observation before running the repair.');
  if (!Array.isArray(value.operations)) errors.push('The repair operation graph is missing.');
  else validateOperations(value.operations, errors);
  if (!isRecord(value.observations) || !exactKeys(value.observations, ['providerReady', 'accountIntentRequested', 'accountsListed', 'walletLookupReceived', 'chainVerified', 'orderFulfilled'])) {
    errors.push('The repair observations are malformed.');
  } else if (!Object.values(value.observations).every((item) => typeof item === 'boolean')) {
    errors.push('Repair observations must be explicit booleans.');
  }
  if (errors.length > 0) return fail(errors);

  const observations = value.observations as BuilderRepairSubmission['observations'];
  const cancelled = (value.operations as BuilderOperation[]).some((operation) => operation.method === 'wallet-cancelled');
  if (cancelled) {
    const recoverable = observations.providerReady && observations.accountIntentRequested && observations.accountsListed && !observations.walletLookupReceived && !observations.chainVerified && !observations.orderFulfilled;
    return recoverable ? success() : fail(['Cancellation must return to the same order without claiming fulfillment.']);
  }
  const complete = Object.values(observations).every(Boolean);
  return complete ? success() : fail(['The repair stopped before every authority boundary was observed.']);
}

function validateOperations(operations: unknown[], errors: string[]): void {
  if (operations.length === BUILDER_OPERATION_ORDER.length && operations.every((item, index) => isRecord(item) && item.method === BUILDER_OPERATION_ORDER[index])) {
    for (const operation of operations) validateOperation(operation as unknown as BuilderOperation, errors);
    return;
  }
  const cancelled = operations.find((item) => isRecord(item) && item.method === 'wallet-cancelled');
  const retry = operations.find((item) => isRecord(item) && item.method === 'retry-payment');
  if (!cancelled || !retry || operations.length < 6) {
    errors.push('Operations must follow the allowlisted provider and payment order.');
    return;
  }
  const prefix = operations.slice(0, operations.indexOf(cancelled));
  if (!prefix.every((item, index) => isRecord(item) && item.method === BUILDER_OPERATION_ORDER[index])) errors.push('Cancellation occurred outside the allowlisted recovery path.');
  const cancelledRecord = isRecord(cancelled) ? cancelled : null;
  const cancelledArgs = cancelledRecord && exactKeys(cancelledRecord.args, ['recoverable']) ? cancelledRecord.args : null;
  if (!cancelledRecord || cancelledRecord.method !== 'wallet-cancelled' || !cancelledArgs || cancelledArgs.recoverable !== true) errors.push('Cancellation must be explicit and recoverable.');
  const retryRecord = isRecord(retry) ? retry : null;
  const retryArgs = retryRecord && exactKeys(retryRecord.args, ['sameOrder']) ? retryRecord.args : null;
  if (!retryRecord || retryRecord.method !== 'retry-payment' || !retryArgs || retryArgs.sameOrder !== true) errors.push('Retry must reuse the same server order.');
}

function validateOperation(operation: BuilderOperation, errors: string[]): void {
  if (!isRecord(operation) || typeof operation.method !== 'string' || !isRecord(operation.args)) { errors.push('Each operation must be typed.'); return; }
  if (operation.method === 'provider-init') expectArgs(operation.args, ['timeoutMs'], { timeoutMs: 2_500 }, errors);
  else if (operation.method === 'request-user-intent') expectArgs(operation.args, ['purpose'], { purpose: 'harbor-lantern' }, errors);
  else if (operation.method === 'list-accounts') expectArgs(operation.args, [], {}, errors);
  else if (operation.method === 'prepare-basic-payment' || operation.method === 'send-basic-payment') {
    expectArgs(operation.args, ['network', 'recipient', 'valueLuna'], { network: 'testalbatross', recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna }, errors);
  } else if (operation.method === 'reconcile-chain') expectArgs(operation.args, ['minimumConfirmations'], { minimumConfirmations: LAST_LANTERN.minimumConfirmations }, errors);
  else if (operation.method === 'fulfill-order') expectArgs(operation.args, ['itemId'], { itemId: 'harbor-lantern' }, errors);
  else errors.push(`Operation ${operation.method} is not allowlisted.`);
}

function matchesPredictions(value: unknown[]): boolean {
  return value.length === EXPECTED_PREDICTIONS.length && value.every((item, index) => isRecord(item) && exactKeys(item, ['step', 'prediction']) && item.step === EXPECTED_PREDICTIONS[index]![0] && item.prediction === EXPECTED_PREDICTIONS[index]![1]);
}

function expectArgs(value: Record<string, unknown>, keys: string[], expected: Record<string, unknown>, errors: string[]): void {
  if (!exactKeys(value, keys) || keys.some((key) => value[key] !== expected[key])) errors.push('An operation contains an unexpected or incorrect argument.');
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function success(): BuilderRepairResult { return { ok: true, recipeUnlocked: true, score: 100, errors: [] }; }
function fail(errors: string[]): BuilderRepairResult { return { ok: false, recipeUnlocked: false, score: 0, errors }; }
