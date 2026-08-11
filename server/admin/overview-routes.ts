import type { Express, RequestHandler } from 'express';
import type { AdminConfigEntry } from './config';
import type { EffectiveHealth } from './health';

export interface AdminOverviewRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  health: () => EffectiveHealth;
  inventory: () => AdminConfigEntry[];
  date: () => string;
  commit: string | null;
  uptimeSeconds: () => number;
}

export function mountAdminOverviewRoutes(deps: AdminOverviewRoutesDeps): void {
  const { app, limit, requireAdmin, health, inventory, date, commit, uptimeSeconds } = deps;

  app.get('/admin/api/overview', limit(30, 10), requireAdmin, (_req, res) => {
    res.json({
      ok: true,
      uptimeSeconds: uptimeSeconds(),
      commit,
      date: date(),
      ...health(),
      config: inventory(),
    });
  });
}
