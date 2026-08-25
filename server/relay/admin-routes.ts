import type { Express, RequestHandler } from 'express';

import type { OperationNonces } from '../admin/nonces';
import type { RelayPayoutService } from './payouts';
import type { RelayRewardService } from './rewards';

export function mountRelayAdminRoutes(options: { app: Express; limit: (perMinute: number, burst: number) => RequestHandler; requireAdmin: RequestHandler; nonces: OperationNonces; payouts: RelayPayoutService; rewards: RelayRewardService }): void {
  const { app, limit, requireAdmin, nonces, payouts, rewards } = options;
  app.get('/admin/api/relay/rewards', limit(30, 10), requireAdmin, async (_req, res) => { res.setHeader('cache-control', 'no-store'); res.json({ ok: true, rewards: await rewards.publicRecords() }); });
  app.post('/admin/api/relay/payouts/:payoutId/approve', limit(6, 2), requireAdmin, async (req, res) => {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, `relay.payout.approve:${req.params.payoutId}`)) { res.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    try { res.json({ ok: true, payout: await payouts.approve(String(req.params.payoutId)) }); } catch { res.status(409).json({ error: 'Payout approval was refused.' }); }
  });
  app.post('/admin/api/relay/payouts/:payoutId/transaction', limit(6, 2), requireAdmin, async (req, res) => {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, `relay.payout.transaction:${req.params.payoutId}`)) { res.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    const transactionHash = typeof req.body?.transactionHash === 'string' ? req.body.transactionHash : '';
    try { res.json({ ok: true, payout: await payouts.recordSubmitted(String(req.params.payoutId), transactionHash) }); } catch { res.status(409).json({ error: 'Payout submission was refused.' }); }
  });
  app.post('/admin/api/relay/payouts/:payoutId/reconcile', limit(12, 3), requireAdmin, async (req, res) => {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, `relay.payout.reconcile:${req.params.payoutId}`)) { res.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    try { res.json({ ok: true, payout: await payouts.reconcile(String(req.params.payoutId)) }); } catch { res.status(409).json({ error: 'Payout reconciliation was refused.' }); }
  });
}
