import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { networkOf } from './network';
import type { PlayerAuth } from './player-auth';
import { mergeBodyDigest, type AuthAction } from '../src/net/player-auth-protocol';

const playerId = z.string().regex(/^[0-9a-f]{16,64}$/i, 'Device id must be hex.');
const publicKeyJwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().min(1).max(100),
  y: z.string().min(1).max(100),
  key_ops: z.array(z.string()).optional(),
  ext: z.boolean().optional(),
});
const PLAYER_ACTIONS = [
  'chat.say', 'chat.edit', 'tips.report', 'tips.seen',
  'clan.join', 'clan.decide', 'contest.create', 'contest.join',
  'contest.settle', 'challenge.create', 'challenge.accept',
  'challenge.settle', 'signals.unlock', 'score.post', 'score.sign',
  'score.anchor', 'ghost.post',
] as const satisfies readonly AuthAction[];

export interface PlayerAuthRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  auth: PlayerAuth;
  save: () => void;
}

export function mountPlayerAuthRoutes(deps: PlayerAuthRoutesDeps): void {
  const { app, limit, auth, save } = deps;

  app.post('/auth/player/register', limit(8, 2), async (req, res) => {
    const parsed = z.object({ publicKeyJwk }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'invalid_request' });
      return;
    }
    const registered = await auth.register({ publicKeyJwk: parsed.data.publicKeyJwk });
    if (!registered.ok) {
      res.status(400).json({ ok: false, error: 'invalid_request' });
      return;
    }
    save();
    res.json({ ok: true, playerId: registered.value.playerId });
  });

  app.post('/auth/player/challenge', limit(24, 8), async (req, res) => {
    const parsed = z.discriminatedUnion('action', [
      z.object({ playerId, action: z.literal('profile.merge'), claim: z.object({ from: playerId, into: playerId }) }),
      z.object({ playerId, action: z.enum(PLAYER_ACTIONS), bodyDigest: z.string().regex(/^[0-9a-f]{64}$/i) }),
    ]).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: 'invalid_request' });
      return;
    }
    const digest = parsed.data.action === 'profile.merge'
      ? await mergeBodyDigest({ ...parsed.data.claim, network: networkOf(req) })
      : parsed.data.bodyDigest;
    const issued = auth.issueChallenge({ playerId: parsed.data.playerId, action: parsed.data.action, bodyDigest: digest });
    if (!issued.ok) {
      res.status(403).json({ ok: false, error: 'unauthorized' });
      return;
    }
    res.json({ ok: true, challenge: issued.value });
  });
}
