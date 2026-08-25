export const BUILDER_RECIPE_VERSION = 1 as const;

export const BUILDER_OPERATION_ORDER = [
  'provider-init', 'request-user-intent', 'list-accounts', 'prepare-basic-payment',
  'send-basic-payment', 'reconcile-chain', 'fulfill-order',
] as const;

export type BuilderOperationMethod = (typeof BUILDER_OPERATION_ORDER)[number] | 'wallet-cancelled' | 'retry-payment';
export type BuilderPredictionStep = 'provider-init' | 'user-intent' | 'list-accounts' | 'prepare-payment' | 'wallet-result' | 'chain-reconcile' | 'fulfillment';

export interface BuilderOperation {
  method: BuilderOperationMethod;
  args: Record<string, unknown>;
}

export interface BuilderPrediction {
  step: BuilderPredictionStep;
  prediction: string;
}

export interface BuilderRepairObservations {
  providerReady: boolean;
  accountIntentRequested: boolean;
  accountsListed: boolean;
  walletLookupReceived: boolean;
  chainVerified: boolean;
  orderFulfilled: boolean;
}

export interface BuilderRepairSubmission {
  trialId: 'harbor-repair-v1';
  recipeVersion: number;
  predictions: BuilderPrediction[];
  operations: BuilderOperation[];
  observations: BuilderRepairObservations;
}
