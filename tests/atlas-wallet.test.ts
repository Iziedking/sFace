import { describe, expect, it, vi } from 'vitest';

import { createAtlasWalletAdapter } from '../src/atlas/wallet';

describe('Nimiq Pay wallet boundary', () => {
  it('does not initialize or request accounts until an explicit wallet action', async () => {
    const provider = { listAccounts: vi.fn().mockResolvedValue(['NQwallet']), sendBasicTransaction: vi.fn() };
    const initialize = vi.fn().mockResolvedValue(provider);
    const wallet = createAtlasWalletAdapter({ initialize });
    expect(initialize).not.toHaveBeenCalled();
    await expect(wallet.initialize()).resolves.toMatchObject({ ok: true });
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(provider.listAccounts).not.toHaveBeenCalled();
    await expect(wallet.requestAccounts()).resolves.toEqual(['NQwallet']);
    expect(provider.listAccounts).toHaveBeenCalledTimes(1);
  });

  it('returns an honest unavailable state when provider initialization times out', async () => {
    const wallet = createAtlasWalletAdapter({ initialize: vi.fn().mockRejectedValue(new Error('timeout')) });
    await expect(wallet.initialize()).resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('sends only the reviewed exact payment and returns a lookup value, never verified proof', async () => {
    const provider = { listAccounts: vi.fn().mockResolvedValue(['NQwallet']), sendBasicTransaction: vi.fn().mockResolvedValue('hash-1') };
    const wallet = createAtlasWalletAdapter({ initialize: vi.fn().mockResolvedValue(provider) });
    await wallet.initialize();
    await wallet.requestAccounts();
    await expect(wallet.sendBasicPayment({ recipient: 'NQrecipient', valueLuna: 100_000 })).resolves.toEqual({ kind: 'lookup', value: 'hash-1' });
    expect(provider.sendBasicTransaction).toHaveBeenCalledWith({ recipient: 'NQrecipient', value: 100_000 });
  });

  it('rejects provider error objects and malformed results without claiming payment', async () => {
    const provider = { listAccounts: vi.fn().mockResolvedValue(['NQwallet']), sendBasicTransaction: vi.fn().mockResolvedValue({ error: { type: 'PermissionDeniedError', message: 'cancelled' } }) };
    const wallet = createAtlasWalletAdapter({ initialize: vi.fn().mockResolvedValue(provider) });
    await wallet.initialize();
    await wallet.requestAccounts();
    await expect(wallet.sendBasicPayment({ recipient: 'NQrecipient', valueLuna: 100_000 })).rejects.toThrow(/cancel|provider/i);
  });
});
