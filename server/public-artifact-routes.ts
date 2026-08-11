import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import * as challenges from './challenges';
import * as ghosts from './ghosts';

const seed = z.string().min(1).max(120);

export interface PublicArtifactRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
}

export function mountPublicArtifactRoutes(deps: PublicArtifactRoutesDeps): void {
  const { app, limit } = deps;

  app.get('/ghosts', limit(60, 20), (req, res) => {
    const parsed = seed.safeParse(req.query.seed);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bad seed.' });
      return;
    }
    const requested = Number(req.query.limit ?? 4);
    const count = Number.isFinite(requested) ? Math.min(Math.max(1, requested), 8) : 4;
    const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : undefined;
    res.json(ghosts.top(parsed.data, count, exclude));
  });

  app.get('/challenges/:id', limit(120, 40), (req, res) => {
    const result = challenges.get(String(req.params.id));
    if (!result.ok) {
      res.status(result.code).json({ error: result.reason });
      return;
    }
    res.json(challenges.toPublic(result.value));
  });
}
