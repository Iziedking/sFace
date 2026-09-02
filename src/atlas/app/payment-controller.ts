import type { AtlasApiClient, AtlasOrderSummary } from '../api';
import type { AtlasWalletAdapter } from '../wallet';

export type AtlasPaymentControllerStatus = 'idle' | 'review' | 'initializing' | 'accounts' | 'ordering' | 'authorizing' | 'submitting' | 'confirming' | 'verified' | 'fulfilled' | 'cancelled' | 'retryable' | 'failed';

export interface AtlasPaymentControllerRequest {
  itemId: 'harbor-lantern';
  network: 'testalbatross';
  recipient: string;
  valueLuna: number;
}

export interface AtlasPaymentEvidence {
  lookup?: string;
  network: 'testalbatross';
  sender?: string;
  recipient: string;
  valueLuna: number;
  canonical: true;
  success: true;
  confirmations: number;
}

export interface AtlasPaymentControllerSnapshot {
  status: AtlasPaymentControllerStatus;
  orderId: string | null;
  walletAddress: string | null;
  lookup: string | null;
  error: string | null;
  fulfillmentCount: number;
  worldRestored: boolean;
  builderPredictions: Record<string, string>;
  builderObservations: string[];
  evidence?: AtlasPaymentEvidence | null;
}

interface PaymentPersistence {
  load(): AtlasPaymentControllerSnapshot | null;
  save(snapshot: AtlasPaymentControllerSnapshot): void;
}

type ControllerApi = Pick<AtlasApiClient, 'createOrder' | 'submitTransactionLookup' | 'reconcileOrder' | 'cancelOrder'>;

export class AtlasPaymentController {
  private current: AtlasPaymentControllerSnapshot;

  constructor(private readonly options: {
    actorId: string;
    request: AtlasPaymentControllerRequest;
    wallet: AtlasWalletAdapter;
    api: ControllerApi;
    persistence?: PaymentPersistence;
    minimumConfirmations?: number;
  }) {
    assertRequest(options.actorId, options.request);
    this.current = normalizeSnapshot(options.persistence?.load());
  }

  get state(): AtlasPaymentControllerSnapshot {
    return structuredClone(this.current);
  }

  review(): AtlasPaymentControllerSnapshot {
    if (this.current.status !== 'idle') throw new Error('Atlas payment review is no longer available.');
    return this.setState({ status: 'review', error: null });
  }

  async start(): Promise<AtlasPaymentControllerSnapshot> {
    if (this.current.status === 'confirming' || this.current.status === 'verified' || this.current.status === 'fulfilled') return this.state;
    if (this.current.status === 'idle') this.review();
    if (!['review', 'retryable', 'failed'].includes(this.current.status)) throw new Error(`Atlas payment cannot start from ${this.current.status}.`);

    if (this.current.orderId && this.current.lookup) return this.submitExistingLookup();

    try {
      this.setState({ status: 'initializing', error: null });
      const initialized = await this.options.wallet.initialize();
      if (!initialized.ok) return this.setState({ status: 'retryable', error: `Nimiq Pay is unavailable (${initialized.reason}).` });

      this.setState({ status: 'accounts' });
      const accounts = await this.options.wallet.requestAccounts();
      const walletAddress = accounts[0];
      if (!walletAddress) return this.setState({ status: 'retryable', error: 'Nimiq Pay returned no approved account.' });
      this.setState({ status: 'ordering', walletAddress });

      const order = await this.options.api.createOrder({ actorId: this.options.actorId, walletAddress, itemId: this.options.request.itemId, idempotencyKey: this.idempotencyKey() });
      this.setState({ status: 'authorizing', orderId: order.id });
      const payment = await this.options.wallet.sendBasicPayment({ recipient: this.options.request.recipient, valueLuna: this.options.request.valueLuna });
      if (!payment.value) throw new Error('Nimiq Pay returned an empty transaction lookup.');
      this.setState({ status: 'submitting', lookup: payment.value });
      return this.submitExistingLookup();
    } catch (error) {
      if (this.current.orderId && !this.current.lookup && this.current.status === 'authorizing') {
        try { await this.options.api.cancelOrder(this.current.orderId, 'wallet-cancelled'); } catch { /* Keep the original wallet error visible. */ }
        return this.setState({ status: 'cancelled', error: errorMessage(error, 'The Nimiq Pay approval was cancelled.') });
      }
      return this.setState({ status: 'retryable', error: errorMessage(error, 'The Atlas payment can be retried safely.') });
    }
  }

  async reconcile(): Promise<AtlasPaymentControllerSnapshot> {
    if (!this.current.orderId) return this.setState({ status: 'retryable', error: 'No Atlas order is waiting for confirmation.' });
    if (!['confirming', 'retryable'].includes(this.current.status)) return this.state;
    try {
      const order = await this.options.api.reconcileOrder(this.current.orderId);
      if (order.status !== 'fulfilled') return this.setState({ status: order.status === 'cancelled' ? 'cancelled' : 'confirming', error: null });
      const evidence = canonicalEvidence(order, this.current.walletAddress, this.current.lookup, this.options.request, this.options.minimumConfirmations ?? 3);
      if (!evidence) {
        return this.setState({ status: 'failed', error: 'The server response did not include matching canonical payment evidence.' });
      }
      return this.setState({ status: 'verified', evidence, error: null });
    } catch (error) {
      const message = errorMessage(error, 'Canonical confirmation is temporarily unavailable.');
      return this.setState({ status: /confirm/i.test(message) ? 'confirming' : 'retryable', error: message });
    }
  }

  fulfill(): AtlasPaymentControllerSnapshot {
    if (this.current.status === 'fulfilled') throw new Error('Atlas fulfillment is duplicate.');
    if (this.current.status !== 'verified') throw new Error('Atlas fulfillment requires verified evidence.');
    return this.setState({ status: 'fulfilled', fulfillmentCount: 1, worldRestored: true });
  }

  async cancel(reason: 'player-exit' | 'wallet-cancelled' | 'wallet-unavailable'): Promise<AtlasPaymentControllerSnapshot> {
    if (this.current.status === 'fulfilled') throw new Error('Fulfilled Atlas payments cannot be cancelled.');
    if (this.current.orderId && !this.current.lookup) await this.options.api.cancelOrder(this.current.orderId, reason);
    return this.setState({ status: 'cancelled', error: reason });
  }

  predictBuilder(stepId: string, prediction: string): void {
    assertBuilderValue(stepId, prediction);
    this.current.builderPredictions[stepId] = prediction;
    this.persist();
  }

  observeBuilder(stepId: string, observation: string): { stepId: string; prediction: string; observation: string } {
    const prediction = this.current.builderPredictions[stepId];
    if (!prediction) throw new Error('Builder must predict before observing.');
    if (this.current.builderObservations.includes(stepId)) throw new Error('Builder observation is duplicate.');
    this.current.builderObservations.push(stepId);
    this.persist();
    return { stepId, prediction, observation };
  }

  private async submitExistingLookup(): Promise<AtlasPaymentControllerSnapshot> {
    if (!this.current.orderId || !this.current.lookup) return this.setState({ status: 'retryable', error: 'Atlas payment lookup is missing.' });
    try {
      this.setState({ status: 'submitting' });
      await this.options.api.submitTransactionLookup(this.current.orderId, this.current.lookup);
      return this.setState({ status: 'confirming', error: null });
    } catch (error) {
      return this.setState({ status: 'retryable', error: errorMessage(error, 'The payment lookup can be submitted again safely.') });
    }
  }

  private idempotencyKey(): string {
    return `atlas-${this.options.actorId}-${this.options.request.itemId}`.slice(0, 128);
  }

  private setState(patch: Partial<AtlasPaymentControllerSnapshot>): AtlasPaymentControllerSnapshot {
    this.current = { ...this.current, ...patch, builderPredictions: { ...this.current.builderPredictions }, builderObservations: [...this.current.builderObservations] };
    this.persist();
    return this.state;
  }

  private persist(): void {
    this.options.persistence?.save(this.state);
  }
}

function assertRequest(actorId: string, request: AtlasPaymentControllerRequest): void {
  if (!actorId || request.itemId !== 'harbor-lantern' || request.network !== 'testalbatross' || !request.recipient || !Number.isSafeInteger(request.valueLuna) || request.valueLuna <= 0) throw new Error('Atlas payment request is incomplete.');
  if (/^(NQATLASLANTERNSHOP|LOCAL_FIXTURE_RECIPIENT)$/.test(request.recipient)) throw new Error('The local practice recipient cannot be used for a live payment.');
}

function canonicalEvidence(order: AtlasOrderSummary, walletAddress: string | null, submittedLookup: string | null, request: AtlasPaymentControllerRequest, minimumConfirmations: number): AtlasPaymentEvidence | null {
  if (!walletAddress || !submittedLookup || order.lookup !== submittedLookup) return null;
  const evidence = order.chainEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const value = evidence as Record<string, unknown>;
  if (!(value.network === request.network
    && (value.sender === undefined || value.sender === walletAddress)
    && value.recipient === request.recipient
    && value.valueLuna === request.valueLuna
    && value.canonical === true
    && value.success === true
    && Number.isSafeInteger(value.confirmations)
    && (value.confirmations as number) >= minimumConfirmations)) return null;
  if (value.lookup !== undefined && value.lookup !== submittedLookup) return null;
  return {
    ...(value.lookup === undefined ? {} : { lookup: submittedLookup }),
    network: request.network,
    ...(value.sender === undefined ? {} : { sender: walletAddress }),
    recipient: request.recipient,
    valueLuna: request.valueLuna,
    canonical: true,
    success: true,
    confirmations: value.confirmations as number,
  };
}

function normalizeSnapshot(snapshot: AtlasPaymentControllerSnapshot | null | undefined): AtlasPaymentControllerSnapshot {
  const persistedStatus = isStatus(snapshot?.status) ? snapshot.status : 'idle';
  const recoveryStatus: AtlasPaymentControllerStatus = persistedStatus === 'verified' || persistedStatus === 'fulfilled'
    ? (snapshot?.orderId && snapshot.lookup ? 'confirming' : 'idle')
    : persistedStatus;
  return {
    status: recoveryStatus,
    orderId: snapshot?.orderId ?? null,
    walletAddress: snapshot?.walletAddress ?? null,
    lookup: snapshot?.lookup ?? null,
    error: recoveryStatus === 'confirming' && persistedStatus !== 'confirming' ? 'Restored payment requires fresh canonical confirmation.' : snapshot?.error ?? null,
    fulfillmentCount: 0,
    worldRestored: false,
    builderPredictions: { ...(snapshot?.builderPredictions ?? {}) },
    builderObservations: [...(snapshot?.builderObservations ?? [])],
    evidence: null,
  };
}

function isStatus(value: unknown): value is AtlasPaymentControllerStatus {
  return value === 'idle' || value === 'review' || value === 'initializing' || value === 'accounts' || value === 'ordering' || value === 'authorizing' || value === 'submitting' || value === 'confirming' || value === 'verified' || value === 'fulfilled' || value === 'cancelled' || value === 'retryable' || value === 'failed';
}

function assertBuilderValue(stepId: string, prediction: string): void {
  if (!/^[a-z0-9-]{1,64}$/.test(stepId) || prediction.length === 0 || prediction.length > 200) throw new Error('Builder prediction is invalid.');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
