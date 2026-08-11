import type { Express, RequestHandler } from 'express';
import * as clans from './clans';
import * as contests from './contests';
import { sweepContests } from './contest-lifecycle';
import { networkOf } from './network';

export interface CommunityReadRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
}

export function mountCommunityReadRoutes(deps: CommunityReadRoutesDeps): void {
  const { app, limit } = deps;

  app.get('/contests', limit(120, 40), (req, res) => {
    const network = networkOf(req);
    sweepContests(network);
    res.json(contests.list(network));
  });

  app.get('/contests/:id', limit(120, 40), (req, res) => {
    const network = networkOf(req);
    sweepContests(network);
    const found = contests.get(String(req.params.id ?? ''), network);
    if (!found.ok) {
      res.status(found.code).json({ error: found.reason });
      return;
    }
    res.json(contests.toPublic(found.value));
  });

  app.get('/clans', limit(120, 40), (req, res) => {
    res.json(clans.table(50, networkOf(req)));
  });

  app.get('/clans/:tag', limit(120, 40), (req, res) => {
    const tag = clans.normaliseTag(req.params.tag);
    if (!tag) {
      res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
      return;
    }
    const found = clans.detail(tag, networkOf(req));
    if (!found) {
      res.json({ tag, face: 0, members: 0, bestScore: 0, topPilot: null, topPilotAvatar: null, roster: [], place: 0 });
      return;
    }
    res.json(found);
  });
}
