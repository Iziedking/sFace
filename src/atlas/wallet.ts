import { init, type NimiqProvider } from '@nimiq/mini-app-sdk';

/*
 * Nimiq Mini App SDK 0.1.0, node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts,
 * inspected 2026-09-06. The provider signs an exact string and returns the
 * wallet public key plus signature; this is used only for wallet identity
 * binding, never for a transaction.
 */

export interface AtlasWalletSignature {
  publicKey: string;
  signature: string;
}

export interface AtlasWalletProvider {
  listAccounts(): Promise<unknown>;
  sign(message: string): Promise<unknown>;
  /** Nimiq Provider API returns a lookup string; it is not chain proof. */
  sendBasicTransaction(input: { recipient: string; value: number }): Promise<unknown>;
}

export type AtlasWalletInitialization =
  | { ok: true; provider: AtlasWalletProvider }
  | { ok: false; reason: 'timeout' | 'unavailable' };

export interface AtlasWalletAdapter {
  initialize(): Promise<AtlasWalletInitialization>;
  requestAccounts(): Promise<string[]>;
  signWalletMessage(message: string): Promise<AtlasWalletSignature>;
  sendBasicPayment(input: { recipient: string; valueLuna: number }): Promise<{ kind: 'lookup'; value: string }>;
}

export function createAtlasWalletAdapter(options: { initialize?: () => Promise<AtlasWalletProvider>; timeoutMs?: number } = {}): AtlasWalletAdapter {
  let provider: AtlasWalletProvider | null = null;
  return {
    async initialize() {
      try {
        provider = await (options.initialize ?? (() => init({ timeout: options.timeoutMs ?? 2_500 }) as Promise<NimiqProvider>))();
        return { ok: true, provider };
      } catch (error) {
        provider = null;
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        return { ok: false, reason: message.includes('timeout') ? 'timeout' : 'unavailable' };
      }
    },
    async requestAccounts() {
      if (!provider) throw new Error('Nimiq Pay is unavailable. Choose the wallet action to retry.');
      const result = await provider.listAccounts();
      if (isProviderError(result)) throw new Error(`Nimiq Pay account request failed: ${result.error.message}`);
      if (!Array.isArray(result) || result.length === 0 || result.some((item) => typeof item !== 'string' || item.length === 0)) throw new Error('Nimiq Pay returned no usable account.');
      return [...result] as string[];
    },
    async signWalletMessage(message) {
      if (!provider) throw new Error('Nimiq Pay is unavailable. Choose the wallet action to retry.');
      if (message.length === 0 || message.length > 2_000) throw new Error('The wallet identity message is invalid.');
      const result = await provider.sign(message);
      if (isProviderError(result)) throw new Error(`Nimiq Pay wallet signature failed: ${result.error.message}`);
      if (!isWalletSignature(result)) throw new Error('Nimiq Pay returned a malformed wallet signature.');
      return result;
    },
    async sendBasicPayment(input) {
      if (!provider) throw new Error('Nimiq Pay is unavailable. Choose the wallet action to retry.');
      if (!Number.isSafeInteger(input.valueLuna) || input.valueLuna <= 0 || input.recipient.length === 0) throw new Error('The reviewed payment is invalid.');
      const result = await provider.sendBasicTransaction({ recipient: input.recipient, value: input.valueLuna });
      if (isProviderError(result)) throw new Error(`Nimiq Pay payment request failed: ${result.error.message}`);
      if (typeof result !== 'string' || result.length === 0) throw new Error('Nimiq Pay returned a malformed transaction lookup.');
      return { kind: 'lookup', value: result };
    },
  };
}

function isProviderError(value: unknown): value is { error: { type: string; message: string } } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === 'object' && !Array.isArray(error) && typeof (error as { type?: unknown }).type === 'string' && typeof (error as { message?: unknown }).message === 'string');
}

function isWalletSignature(value: unknown): value is AtlasWalletSignature {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.publicKey === 'string'
    && /^[0-9a-f]+$/i.test(candidate.publicKey)
    && typeof candidate.signature === 'string'
    && /^[0-9a-f]+$/i.test(candidate.signature);
}
