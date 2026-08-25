import type { Express, RequestHandler } from 'express';
import type { EffectiveHealth } from './admin/health';
import type { MissionResponse } from './daily';
import { isRehearsal } from './network';

export interface SystemRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  health: () => EffectiveHealth;
  date: () => string;
  mission: (input: { rehearsal: boolean }) => Promise<MissionResponse | null>;
}

export function mountSystemRoutes(deps: SystemRoutesDeps): void {
  const { app, limit, health, date, mission } = deps;

  app.get('/health', (_req, res) => {
    const effective = health();
    res.status(effective.relayPersistence.status === 'healthy' ? 200 : 503).json({
      ok: effective.relayPersistence.status === 'healthy',
      date: date(),
      ...effective,
    });
  });

  app.get('/mission/today', limit(120, 40), async (req, res) => {
    const current = await mission({ rehearsal: isRehearsal(req) });
    if (!current) {
      res.status(503).json({ error: 'The market is unreachable. Play the practice mission.' });
      return;
    }
    res.setHeader('cache-control', 'public, max-age=300');
    res.json({ ...current.payload, stale: current.stale });
  });
}

