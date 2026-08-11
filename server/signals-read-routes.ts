import type { Express, RequestHandler } from 'express';
import * as signals from './xsignals';
import { isRehearsal } from './network';

export interface SignalsReadRoutesDeps { app: Express; limit: (perMinute: number, burst: number) => RequestHandler; }

export function mountSignalsReadRoutes(deps: SignalsReadRoutesDeps): void {
  const { app, limit } = deps;
  app.get('/signals/:handle', limit(20, 8), async (req, res) => {
    const handle = String(req.params.handle ?? '').replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) { res.status(400).json({ error: 'Not an X handle.' }); return; }
    const asked = req.query.depth === 'full';
    const who = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
    const paid = signals.treasury() === null || (who !== '' && signals.unlocked(who));
    const depth = asked && paid ? 'full' : 'glance';
    if (isRehearsal(req)) {
      res.json({ handle, rehearsal: true, note: 'CT Signals reads live X, so it is off on testnet. Switch to mainnet for the real read.', priceNim: signals.SIGNALS_PRICE_NIM, treasury: signals.treasury(), unlocked: false });
      return;
    }
    const out = await signals.readSignals(handle, depth);
    if (!out) { res.status(503).json({ error: 'Could not read X right now. Try later.' }); return; }
    res.json({ ...out, priceNim: signals.SIGNALS_PRICE_NIM, treasury: signals.treasury(), unlocked: paid });
  });
}
