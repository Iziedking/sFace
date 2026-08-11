import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { ROSTER_SIZE } from './xsense';
import * as board from './leaderboard';
import * as ghosts from './ghosts';
import type { AuthAction, DeviceProof } from '../src/net/player-auth-protocol';

const deviceId = z.string().regex(/^[0-9a-f]{16,64}$/i);
const pilotName = z.string().min(1).max(32);
const seed = z.string().min(1).max(120);
const publicKeyJwk = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().min(1).max(100), y: z.string().min(1).max(100), key_ops: z.array(z.string()).optional(), ext: z.boolean().optional() });
const deviceProof = z.object({ challengeId: z.string().min(1).max(128), publicKeyJwk, signature: z.string().regex(/^[0-9a-f]+$/i).max(1024) });
const ghostBody = z.object({ deviceId, name: pilotName, seed, score: z.number().int().min(0).max(board.SCORE_CEILING), facesExtracted: z.number().int().min(0).max(ROSTER_SIZE), trace: z.string().min(8).max(ghosts.MAX_TRACE_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/) });

type ActorVerifier = (proof: DeviceProof, action: AuthAction, actorId: string, signedBody: unknown) => Promise<boolean>;
export interface GhostWriteRoutesDeps { app: Express; limit: (perMinute: number, burst: number) => RequestHandler; provesActor: ActorVerifier; }

export function mountGhostWriteRoutes(deps: GhostWriteRoutesDeps): void {
  const { app, limit, provesActor } = deps;
  app.post('/ghosts', limit(8, 4), async (req, res) => {
    const parsed = ghostBody.extend({ auth: deviceProof }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: firstIssue(parsed.error) }); return; }
    const { auth, ...ghost } = parsed.data;
    if (!(await provesActor(auth, 'ghost.post', ghost.deviceId, ghost))) { res.status(403).json({ error: 'unauthorized' }); return; }
    const result = ghosts.submit(ghost);
    if (!result.ok) { res.status(result.code).json({ error: result.reason }); return; }
    res.json(result.value);
  });
}

function firstIssue(error: z.ZodError): string { return error.issues[0]?.message ?? 'Bad request.'; }
