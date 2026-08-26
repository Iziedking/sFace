import type { AtlasApiClient, AtlasOrderSummary } from './api';
import type { AtlasWalletAdapter } from './wallet';

export type AtlasPaymentStage = 'review' | 'initializing' | 'accounts' | 'ordering' | 'authorizing' | 'submitting';

export class AtlasPaymentError extends Error {
  constructor(readonly stage: AtlasPaymentStage, message: string, options?: { cause?: unknown }) {
    super(message);
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
    this.name = 'AtlasPaymentError';
  }
}

export interface AtlasPaymentRequest {
  actorId: string;
  itemId: 'harbor-lantern';
  recipient: string;
  valueLuna: number;
  idempotencyKey?: string;
}

export interface AtlasPaymentResult {
  order: AtlasOrderSummary;
  walletAddress: string;
  lookup: string;
  paymentVerified: false;
}

type PaymentApi = Pick<AtlasApiClient, 'createOrder' | 'submitTransactionLookup'> & Partial<Pick<AtlasApiClient, 'cancelOrder'>>;

export async function executeAtlasPayment(options: AtlasPaymentRequest & { wallet: AtlasWalletAdapter; api: PaymentApi }): Promise<AtlasPaymentResult> {
  assertReviewedPayment(options);

  const initialized = await options.wallet.initialize();
  if (!initialized.ok) throw new AtlasPaymentError('initializing', `Nimiq Pay is unavailable (${initialized.reason}). Choose the wallet action to retry.`);

  let accounts: string[];
  try {
    accounts = await options.wallet.requestAccounts();
  } catch (error) {
    throw new AtlasPaymentError('accounts', errorMessage(error, 'Nimiq Pay account approval was not completed.'), { cause: error });
  }
  const walletAddress = accounts[0];
  if (!walletAddress) throw new AtlasPaymentError('accounts', 'Nimiq Pay returned no approved account.');

  let order: AtlasOrderSummary;
  try {
    order = await options.api.createOrder({
      actorId: options.actorId,
      walletAddress,
      itemId: options.itemId,
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    });
  } catch (error) {
    throw new AtlasPaymentError('ordering', errorMessage(error, 'The Atlas payment order could not be created.'), { cause: error });
  }

  let lookup: string;
  try {
    const result = await options.wallet.sendBasicPayment({ recipient: options.recipient, valueLuna: options.valueLuna });
    lookup = result.value;
  } catch (error) {
    await cancelCreatedOrder(options.api, order.id, 'wallet-cancelled');
    throw new AtlasPaymentError('authorizing', errorMessage(error, 'The Nimiq Pay approval was not completed.'), { cause: error });
  }

  try {
    const submitted = await options.api.submitTransactionLookup(order.id, lookup);
    return { order: submitted, walletAddress, lookup, paymentVerified: false };
  } catch (error) {
    throw new AtlasPaymentError('submitting', errorMessage(error, 'The payment lookup could not be submitted. Retry from the order review.'), { cause: error });
  }
}

function assertReviewedPayment(input: AtlasPaymentRequest): void {
  if (!input.actorId || input.itemId !== 'harbor-lantern' || !input.recipient || !Number.isSafeInteger(input.valueLuna) || input.valueLuna <= 0) {
    throw new AtlasPaymentError('review', 'The reviewed payment is incomplete.');
  }
  if (/^(NQATLASLANTERNSHOP|LOCAL_FIXTURE_RECIPIENT)$/.test(input.recipient)) {
    throw new AtlasPaymentError('review', 'The local practice recipient cannot be used for a live payment.');
  }
}

async function cancelCreatedOrder(api: PaymentApi, orderId: string, reason: string): Promise<void> {
  if (!api.cancelOrder) return;
  try { await api.cancelOrder(orderId, reason); } catch { /* Preserve the wallet cancellation as the user-facing result. */ }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
