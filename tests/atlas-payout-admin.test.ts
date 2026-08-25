import express from 'express';
import { describe, expect, it } from 'vitest';

import { adminMiddleware } from '../server/admin/auth';
import { OperationNonces } from '../server/admin/nonces';
import { mountAtlasPayoutAdminRoutes } from '../server/atlas/payout-admin-routes';
import { createAtlasPayoutService } from '../server/atlas/payouts';

describe('Atlas payout administrator routes', () => {
  it('requires administrator auth and a one-time operation nonce before approval or hash recording', async () => {
    const app = express();
    app.use(express.json());
    const nonces = new OperationNonces(60_000);
    const payouts = createAtlasPayoutService({ network: 'testalbatross', treasuryAddress: 'NQLOCAL_TREASURY', minConfirmations: 3, chain: { observe: async () => null } });
    await payouts.create({ id: 'payout-1', period: 'week-1', walletAddress: 'NQWINNER', amountLuna: 1 });
    mountAtlasPayoutAdminRoutes({ app, limit: () => (_request, _response, next) => next(), requireAdmin: adminMiddleware({ token: 'atlas-admin', allowedIps: [] }), nonces, payouts });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const next = app.listen(0, () => resolve(next)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Atlas payout test server did not expose a port.');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: 'Bearer atlas-admin', 'content-type': 'application/json' };
    try {
      expect((await fetch(`${base}/admin/api/atlas/payouts/payout-1/approve`, { method: 'POST', headers, body: '{}' })).status).toBe(409);
      const approveNonce = nonces.issue('atlas.payout.approve:payout-1');
      expect((await fetch(`${base}/admin/api/atlas/payouts/payout-1/approve`, { method: 'POST', headers, body: JSON.stringify({ nonce: approveNonce }) })).status).toBe(200);
      const transactionNonce = nonces.issue('atlas.payout.transaction:payout-1');
      expect((await fetch(`${base}/admin/api/atlas/payouts/payout-1/transaction`, { method: 'POST', headers, body: JSON.stringify({ nonce: transactionNonce, transactionHash: 'hash-1' }) })).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
