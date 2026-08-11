import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import * as board from './leaderboard';
import { networkOf } from './network';
import * as profiles from './profiles';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.');

export interface LeaderboardReadRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
}

export function mountLeaderboardReadRoutes(deps: LeaderboardReadRoutesDeps): void {
  const { app, limit } = deps;

  app.get('/stats', limit(60, 20), (req, res) => {
    res.json(profiles.usage(networkOf(req)));
  });

  app.get('/board/all-time', limit(120, 40), (req, res) => {
    res.json(profiles.allTime(50, networkOf(req)));
  });

  app.get('/board/:date', limit(120, 40), (req, res) => {
    const date = isoDate.safeParse(req.params.date);
    if (!date.success) {
      res.status(400).json({ error: 'Bad date.' });
      return;
    }
    const network = networkOf(req);
    const rows = board.top(network, date.data).map((entry) => {
      const profile = profiles.get(entry.id, network);
      return {
        ...entry,
        avatarUrl: profile?.avatarUrl ?? null,
        clanTag: profile?.clanTag ?? null,
        lifetimeFace: profile?.lifetimeFace ?? 0,
      };
    });
    res.json(rows);
  });
}
