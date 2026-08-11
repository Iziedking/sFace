import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import * as contestRules from '../src/data/contests';
import type { AuthAction, DeviceProof } from '../src/net/player-auth-protocol';
import * as board from './leaderboard';
import * as challenges from './challenges';

const playerId = z.string().regex(/^[0-9a-f]{16,64}$/i);
const pilotName = z.string().min(1).max(32);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const seed = z.string().min(1).max(120);
const nimiqAddress = z.string().transform((value) => value.replace(/\s/g, '').toUpperCase()).refine((value) => /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(value), 'Not a Nimiq address.');
const publicKeyJwk = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().min(1).max(100), y: z.string().min(1).max(100), key_ops: z.array(z.string()).optional(), ext: z.boolean().optional() });
const deviceProof = z.object({ challengeId: z.string().min(1).max(128), publicKeyJwk, signature: z.string().regex(/^[0-9a-f]+$/i).max(1024) });
const createBody = z.object({ deviceId: playerId, name: pilotName, address: nimiqAddress.nullable(), date: isoDate, seed, stakeNim: z.number().min(challenges.MIN_STAKE_NIM).max(challenges.MAX_STAKE_NIM), score: z.number().int().min(0).max(board.SCORE_CEILING), openMinutes: z.number().int().min(contestRules.MIN_OPEN_MINUTES).max(contestRules.MAX_OPEN_MINUTES).nullable().optional() });
const acceptBody = z.object({ deviceId: playerId, name: pilotName, address: nimiqAddress.nullable(), score: z.number().int().min(0).max(board.SCORE_CEILING), seed });
const settleBody = z.object({ deviceId: playerId, serializedTx: z.string().regex(/^[0-9a-f]+$/i).min(32).max(4096) });

type ActorVerifier = (proof: DeviceProof, action: AuthAction, actorId: string, signedBody: unknown) => Promise<boolean>;
export interface ChallengeWriteRoutesDeps { app: Express; limit: (perMinute: number, burst: number) => RequestHandler; provesActor: ActorVerifier; }

export function mountChallengeWriteRoutes(deps: ChallengeWriteRoutesDeps): void {
  const { app, limit, provesActor } = deps;
  app.post('/challenges', limit(12, 6), async (req, res) => {
    const parsed = createBody.extend({ auth: deviceProof }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: firstIssue(parsed.error) }); return; }
    const { auth, ...created } = parsed.data;
    if (!(await provesActor(auth, 'challenge.create', created.deviceId, created))) { res.status(403).json({ error: 'unauthorized' }); return; }
    const result = challenges.create(created);
    if (!result.ok) { res.status(result.code).json({ error: result.reason }); return; }
    res.status(201).json(challenges.toPublic(result.value));
  });
  app.post('/challenges/:id/accept', limit(20, 10), async (req, res) => {
    const parsed = acceptBody.extend({ auth: deviceProof }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: firstIssue(parsed.error) }); return; }
    const { auth, ...accepted } = parsed.data;
    const id = String(req.params.id ?? '');
    if (!(await provesActor(auth, 'challenge.accept', accepted.deviceId, { id, ...accepted }))) { res.status(403).json({ error: 'unauthorized' }); return; }
    const result = challenges.accept(id, accepted);
    if (!result.ok) { res.status(result.code).json({ error: result.reason }); return; }
    res.json(challenges.toPublic(result.value));
  });
  app.post('/challenges/:id/settled', limit(20, 10), async (req, res) => {
    const parsed = settleBody.extend({ auth: deviceProof }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: firstIssue(parsed.error) }); return; }
    const { auth, ...settled } = parsed.data;
    const id = String(req.params.id ?? '');
    if (!(await provesActor(auth, 'challenge.settle', settled.deviceId, { id, ...settled }))) { res.status(403).json({ error: 'unauthorized' }); return; }
    const result = challenges.reportSettlement(id, settled);
    if (!result.ok) { res.status(result.code).json({ error: result.reason }); return; }
    res.json(challenges.toPublic(result.value));
  });
}

function firstIssue(error: z.ZodError): string { return error.issues[0]?.message ?? 'Bad request.'; }
