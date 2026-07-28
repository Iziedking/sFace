/**
 * Everything between a finished run and NIM leaving someone's wallet.
 *
 * The three cases at the top of this file are the exact mistakes that were
 * sitting in src/nimiq/payments.ts before it was checked against the installed
 * SDK: a method name that does not exist, NIM passed where Lunas are required,
 * and a resolved error envelope read as a success. Each one is now a test, so
 * a future edit that reintroduces any of them fails here rather than on a
 * judge's phone.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { isProviderError, nimToLunas, lunasToNim, LUNAS_PER_NIM } from '../src/nimiq/wallet';
import { isNimiqAddress, MAX_STAKE_NIM } from '../src/nimiq/payments';

describe('NIM and Lunas', () => {
  it('converts NIM to Lunas at 1e5, which is the trap in this API', () => {
    expect(LUNAS_PER_NIM).toBe(100_000);
    expect(nimToLunas(1)).toBe(100_000);
    expect(nimToLunas(5)).toBe(500_000);
    expect(nimToLunas(0.5)).toBe(50_000);
  });

  it('always produces an integer, because Lunas are indivisible', () => {
    for (const nim of [0.000001, 0.123456, 3.141592, 999.999999]) {
      expect(Number.isInteger(nimToLunas(nim))).toBe(true);
    }
  });

  it('round trips', () => {
    expect(lunasToNim(nimToLunas(12.5))).toBeCloseTo(12.5, 6);
  });
});

describe('provider error discrimination', () => {
  /**
   * The provider resolves with { error } instead of rejecting. A try/catch
   * alone sees a fulfilled promise and reports a payment that never happened.
   */
  it('recognises the error envelope', () => {
    expect(isProviderError({ error: { type: 'DENIED', message: 'User rejected' } })).toBe(true);
  });

  it('does not mistake a successful result for an error', () => {
    expect(isProviderError('abc123deadbeef')).toBe(false);
    expect(isProviderError(['NQ07 0000 0000 0000 0000 0000 0000 0000 0000'])).toBe(false);
    expect(isProviderError(42)).toBe(false);
    expect(isProviderError(null)).toBe(false);
    expect(isProviderError(undefined)).toBe(false);
  });
});

describe('nimiq address validation', () => {
  it('accepts a well formed address with or without spaces', () => {
    expect(isNimiqAddress('NQ07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(true);
    expect(isNimiqAddress('NQ0700000000000000000000000000000000')).toBe(true);
    expect(isNimiqAddress('nq07 0000 0000 0000 0000 0000 0000 0000 0000')).toBe(true);
  });

  it('refuses anything a tampered or truncated deeplink would produce', () => {
    expect(isNimiqAddress('')).toBe(false);
    expect(isNimiqAddress('NQ07 0000')).toBe(false);
    expect(isNimiqAddress('0xdeadbeef')).toBe(false);
    expect(isNimiqAddress(null)).toBe(false);
    expect(isNimiqAddress(undefined)).toBe(false);
    expect(isNimiqAddress(12345)).toBe(false);
    // I, O, W and Z are not in the Nimiq base32 alphabet.
    expect(isNimiqAddress('NQ07 IOWZ 0000 0000 0000 0000 0000 0000 0000')).toBe(false);
  });
});

/**
 * settle() is exercised against a fake provider, because the real one only
 * exists inside Nimiq Pay. The fake matches the shape read out of
 * node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts.
 */
describe('settle', () => {
  const sendBasicTransactionWithData = vi.fn();
  const isConsensusEstablished = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    sendBasicTransactionWithData.mockReset();
    isConsensusEstablished.mockReset().mockResolvedValue(true);

    vi.doMock('@nimiq/mini-app-sdk', () => ({
      init: vi.fn().mockResolvedValue({
        isConsensusEstablished,
        sendBasicTransactionWithData,
        listAccounts: vi.fn().mockResolvedValue(['NQ07 0000 0000 0000 0000 0000 0000 0000 0000']),
      }),
      getHostLanguage: () => 'en',
      requestDeviceIdentifier: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.doUnmock('@nimiq/mini-app-sdk');
  });

  const request = {
    recipient: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    amountNim: 5,
    memo: 'sFace 2026-07-28 8f49573e',
  };

  async function load() {
    return import('../src/nimiq/payments');
  }

  it('sends the stake in Lunas, not NIM', async () => {
    sendBasicTransactionWithData.mockResolvedValue('aabbcc');
    const { settle } = await load();

    await settle(request);

    expect(sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: request.recipient,
      value: 500_000,
      data: request.memo,
    });
  });

  it('returns the serialized transaction rather than looking for a hash', async () => {
    sendBasicTransactionWithData.mockResolvedValue('aabbccddeeff');
    const { settle } = await load();

    const result = await settle(request);

    expect(result).toEqual({ ok: true, serializedTx: 'aabbccddeeff' });
  });

  it('treats a resolved error envelope as a failure, not a success', async () => {
    sendBasicTransactionWithData.mockResolvedValue({
      error: { type: 'REJECTED', message: 'User rejected the request' },
    });
    const { settle } = await load();

    const result = await settle(request);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Payment declined.');
  });

  it('reports insufficient funds in words the player can act on', async () => {
    sendBasicTransactionWithData.mockResolvedValue({
      error: { type: 'FAILED', message: 'Insufficient balance for this transaction' },
    });
    const { settle } = await load();

    const result = await settle(request);

    expect(result).toEqual({ ok: false, reason: 'Not enough NIM to cover that stake.' });
  });

  it('refuses to ask for money while the wallet is still syncing', async () => {
    isConsensusEstablished.mockResolvedValue(false);
    const { settle } = await load();

    const result = await settle(request);

    expect(result.ok).toBe(false);
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled();
  });

  it('refuses a malformed recipient before a dialog is ever shown', async () => {
    const { settle } = await load();

    const result = await settle({ ...request, recipient: 'NQ07 BAD' });

    expect(result.ok).toBe(false);
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled();
  });

  it('refuses a stake above the cap, which can only be a bad link', async () => {
    const { settle } = await load();

    const result = await settle({ ...request, amountNim: MAX_STAKE_NIM + 1 });

    expect(result.ok).toBe(false);
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled();
  });

  it('refuses zero, negative, and non-finite stakes', async () => {
    const { settle } = await load();

    for (const amountNim of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await settle({ ...request, amountNim });
      expect(result.ok).toBe(false);
    }
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled();
  });

  it('refuses a memo too long to fit on chain', async () => {
    const { settle } = await load();

    const result = await settle({ ...request, memo: 'x'.repeat(200) });

    expect(result.ok).toBe(false);
    expect(sendBasicTransactionWithData).not.toHaveBeenCalled();
  });

  it('does not report a payment when the provider throws', async () => {
    sendBasicTransactionWithData.mockRejectedValue(new Error('WebView died'));
    const { settle } = await load();

    const result = await settle(request);

    expect(result.ok).toBe(false);
  });

  it('does not report a payment when the provider returns nothing useful', async () => {
    sendBasicTransactionWithData.mockResolvedValue('');
    const { settle } = await load();

    expect((await settle(request)).ok).toBe(false);
  });
});
