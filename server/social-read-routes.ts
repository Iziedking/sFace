import type { Express, RequestHandler } from 'express';
import * as board from './leaderboard';
import * as chat from './chat';
import { utcDate } from './daily';
import { networkOf } from './network';
import * as profiles from './profiles';
import * as tips from './tips';

export interface SocialReadRoutesDeps { app: Express; limit: (perMinute: number, burst: number) => RequestHandler; }

export function mountSocialReadRoutes(deps: SocialReadRoutesDeps): void {
  const { app, limit } = deps;

  app.get('/chat', limit(240, 60), (req, res) => {
    const network = networkOf(req);
    const messages = chat.recent(network).map((message) => ({
      ...message,
      run: message.runDate ? board.runCard(network, message.runDate, message.pilotId) : null,
    }));
    const people: Record<string, unknown> = {};
    for (const id of chat.speakers(network)) {
      const profile = profiles.get(id, network);
      if (!profile) continue;
      people[id] = { name: profile.name, avatarUrl: profile.avatarUrl, clanTag: profile.clanTag, lifetimeFace: profile.lifetimeFace, address: profile.address };
    }
    const asking = String(req.query.deviceId ?? '');
    const today = utcDate();
    const canShare = asking.length > 0 && board.runCard(network, today, asking) !== null;
    res.json({ messages, people, you: { runDate: canShare ? today : null } });
  });

  app.get('/tips', limit(120, 60), (req, res) => {
    const who = String(req.query.deviceId ?? '');
    if (who.length === 0) { res.status(400).json({ error: 'Who is asking?' }); return; }
    const network = networkOf(req);
    const people: Record<string, unknown> = {};
    for (const id of tips.sendersFor(network, who)) {
      const profile = profiles.get(id, network);
      if (profile) people[id] = { name: profile.name, avatarUrl: profile.avatarUrl };
    }
    res.json({ tips: tips.inbox(network, who), people });
  });
}
