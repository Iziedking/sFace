import express from 'express';
import { describe, expect, it } from 'vitest';

import { adminMiddleware } from '../server/admin/auth';
import { maskAtlasAdminEvidence, mountAtlasAdminRoutes } from '../server/atlas/admin';

describe('Atlas administrator evidence', () => {
  it('masks wallet, recipient, sender, actor, and transaction identifiers', () => {
    const masked = maskAtlasAdminEvidence({ actorId: 'actor-secret-123', walletAddress: 'NQWALLETSECRET', sender: 'NQSENDERSECRET', recipient: 'NQRECIPIENTSECRET', lookup: 'hash-secret-123456' });
    expect(masked).toEqual({ actorId: 'acto...-123', walletAddress: 'NQWA...CRET', sender: 'NQSE...CRET', recipient: 'NQRE...CRET', lookup: 'hash...3456' });
    expect(JSON.stringify(masked)).not.toContain('NQWALLETSECRET');
  });

  it('uses the existing administrator middleware before exposing masked evidence', async () => {
    const app = express();
    mountAtlasAdminRoutes({ app, limit: () => (_request, _response, next) => next(), requireAdmin: adminMiddleware({ token: 'atlas-admin', allowedIps: [] }), evidence: () => [{ walletAddress: 'NQWALLETSECRET', recipient: 'NQRECIPIENTSECRET' }] });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const next = app.listen(0, () => resolve(next)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Atlas admin test server did not expose a port.');
    try {
      expect((await fetch(`http://127.0.0.1:${address.port}/admin/api/atlas/evidence`)).status).toBe(401);
      const response = await fetch(`http://127.0.0.1:${address.port}/admin/api/atlas/evidence`, { headers: { authorization: 'Bearer atlas-admin' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(JSON.stringify(await response.json())).not.toContain('NQWALLETSECRET');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
