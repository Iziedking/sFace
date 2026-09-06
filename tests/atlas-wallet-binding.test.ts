import { describe, expect, it, vi } from 'vitest';

import { canonicalAtlasWalletBindingMessage, type AtlasWalletBindingChallenge } from '../shared/atlas/wallet-binding';
import { createAtlasWalletBindingFlow } from '../src/atlas/wallet-binding';

const challenge: AtlasWalletBindingChallenge = {
  id: 'challenge-1',
  domain: 'https://sface.site',
  purpose: 'atlas-wallet-binding',
  actorId: 'actor-1',
  seasonId: 'season-1',
  address: 'NQwallet',
  network: 'testalbatross',
  nonce: 'nonce-1',
  issuedAt: 1_000,
  expiresAt: 301_000,
};

describe('Atlas wallet binding flow', () => {
  it('requests, signs, and binds only after the explicit bind action', async () => {
    const requestAccounts = vi.fn().mockResolvedValue(['NQwallet']);
    const signWalletMessage = vi.fn().mockResolvedValue({ publicKey: 'a1b2', signature: 'c3d4' });
    const issueWalletChallenge = vi.fn().mockResolvedValue({ ok: true, value: challenge });
    const bindWallet = vi.fn().mockResolvedValue({
      ok: true,
      value: { actorId: 'actor-1', seasonId: 'season-1', address: 'NQwallet', network: 'testalbatross', publicKey: 'a1b2', boundAt: 2_000 },
    });
    const flow = createAtlasWalletBindingFlow({
      api: { issueWalletChallenge, bindWallet },
      wallet: { requestAccounts, signWalletMessage },
    });

    expect(requestAccounts).not.toHaveBeenCalled();
    await expect(flow.bind({ actorId: 'actor-1', seasonId: 'season-1', network: 'testalbatross' })).resolves.toMatchObject({ ok: true });
    expect(issueWalletChallenge).toHaveBeenCalledWith({ actorId: 'actor-1', seasonId: 'season-1', network: 'testalbatross', address: 'NQwallet' });
    expect(signWalletMessage).toHaveBeenCalledWith(canonicalAtlasWalletBindingMessage(challenge));
    expect(bindWallet).toHaveBeenCalledWith({ actorId: 'actor-1', challenge, publicKey: 'a1b2', signature: 'c3d4' });
  });

  it('keeps a cancelled or incomplete wallet action honest', async () => {
    const issueWalletChallenge = vi.fn().mockResolvedValue({ ok: false, error: 'Wallet challenge was rejected.' });
    const bindWallet = vi.fn();
    const flow = createAtlasWalletBindingFlow({
      api: { issueWalletChallenge, bindWallet },
      wallet: { requestAccounts: vi.fn().mockResolvedValue([]), signWalletMessage: vi.fn() },
    });

    await expect(flow.bind({ actorId: 'actor-1', seasonId: 'season-1', network: 'testalbatross' })).resolves.toEqual({ ok: false, error: 'Nimiq Pay returned no usable account.' });
    expect(issueWalletChallenge).not.toHaveBeenCalled();
    expect(bindWallet).not.toHaveBeenCalled();
  });

  it('does not bind when signing fails', async () => {
    const bindWallet = vi.fn();
    const flow = createAtlasWalletBindingFlow({
      api: { issueWalletChallenge: vi.fn().mockResolvedValue({ ok: true, value: challenge }), bindWallet },
      wallet: { requestAccounts: vi.fn().mockResolvedValue(['NQwallet']), signWalletMessage: vi.fn().mockRejectedValue(new Error('Wallet signature cancelled.')) },
    });

    await expect(flow.bind({ actorId: 'actor-1', seasonId: 'season-1', network: 'testalbatross' })).resolves.toEqual({ ok: false, error: 'Wallet signature cancelled.' });
    expect(bindWallet).not.toHaveBeenCalled();
  });
});
