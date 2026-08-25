import type { Express, RequestHandler } from 'express';

import type { OperationNonces } from '../admin/nonces';
import type { AtlasPayoutService } from './payouts';

export function mountAtlasPayoutAdminRoutes(options: { app: Express; limit: (perMinute: number, burst: number) => RequestHandler; requireAdmin: RequestHandler; nonces: OperationNonces; payouts: AtlasPayoutService }): void {
  const { app, limit, requireAdmin, nonces, payouts } = options;
  app.get('/admin/api/atlas/payouts', limit(30, 10), requireAdmin, async (_request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, payouts: await payouts.list() });
  });
  app.post('/admin/api/atlas/payouts/:payoutId/approve', limit(6, 2), requireAdmin, async (request, response) => {
    const id = String(request.params.payoutId);
    const nonce = typeof request.body?.nonce === 'string' ? request.body.nonce : '';
    if (!nonces.consume(nonce, `atlas.payout.approve:${id}`)) { response.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    try { response.json({ ok: true, payout: await payouts.approve(id) }); } catch { response.status(409).json({ error: 'Atlas payout approval was refused.' }); }
  });
  app.post('/admin/api/atlas/payouts/:payoutId/transaction', limit(6, 2), requireAdmin, async (request, response) => {
    const id = String(request.params.payoutId);
    const nonce = typeof request.body?.nonce === 'string' ? request.body.nonce : '';
    if (!nonces.consume(nonce, `atlas.payout.transaction:${id}`)) { response.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    const transactionHash = typeof request.body?.transactionHash === 'string' ? request.body.transactionHash : '';
    try { response.json({ ok: true, payout: await payouts.recordSubmitted(id, transactionHash) }); } catch { response.status(409).json({ error: 'Atlas payout submission was refused.' }); }
  });
  app.post('/admin/api/atlas/payouts/:payoutId/reconcile', limit(12, 3), requireAdmin, async (request, response) => {
    const id = String(request.params.payoutId);
    const nonce = typeof request.body?.nonce === 'string' ? request.body.nonce : '';
    if (!nonces.consume(nonce, `atlas.payout.reconcile:${id}`)) { response.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    try { response.json({ ok: true, payout: await payouts.reconcile(id) }); } catch { response.status(409).json({ error: 'Atlas payout reconciliation was refused.' }); }
  });
}
