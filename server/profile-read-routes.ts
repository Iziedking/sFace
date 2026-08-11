import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import * as board from './leaderboard';
import { networkOf } from './network';
import * as profiles from './profiles';

const playerId = z.string().regex(/^[0-9a-f]{16,64}$/i, 'Device id must be hex.');

export interface ProfileReadRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
}

export function mountProfileReadRoutes(deps: ProfileReadRoutesDeps): void {
  const { app, limit } = deps;

  app.get('/profile/:id', limit(60, 20), (req, res) => {
    const id = playerId.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: 'Bad pilot id.' });
      return;
    }
    const network = networkOf(req);
    const profile = profiles.get(id.data, network);
    if (!profile) {
      res.json(profiles.blank(id.data, 'Pilot', network));
      return;
    }
    res.json({
      ...profile,
      allTimeRank: profiles.rankOf(id.data, network),
      unsigned: board.unsignedFor(network, id.data),
    });
  });
}
