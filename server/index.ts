/**
 * The oracle and challenge service.
 *
 * Small on purpose. It publishes one mission a day, keeps a leaderboard, and
 * stores challenge records. It holds no funds, has no keys, and can move
 * nobody's money, which is why it can run on a single box behind Caddy without
 * a blast-radius document longer than the service itself.
 *
 * Everything crossing the boundary is parsed with zod before it is touched.
 * Every public endpoint is rate limited, because they are all unauthenticated
 * by design and an open POST with no cap is an invitation.
 */

import { isRehearsal, networkOf, NETWORK_HEADER } from './network';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { corsDecision, parseAllowedOrigins } from './cors';
import { pruneRateLimitBuckets, type RateLimitBucket } from './rate-limit';
import { buildCapabilities } from './capabilities';
import { apiSecurityHeaders } from './security-headers';

import * as daily from './daily';
import { getMission, startRefreshLoop, utcDate } from './daily';
import * as board from './leaderboard';
import * as challenges from './challenges';
import * as clans from './clans';
import * as contests from './contests';
import { ROSTER_SIZE, xsenseConfigured } from './xsense';
import * as contestRules from '../src/data/contests';
import * as ghosts from './ghosts';
import * as signals from './xsignals';
import * as profiles from './profiles';
import * as xauth from './xauth';
import { xpostsConfigured } from './xposts';
import { xusersConfigured } from './xusers';
import { attachLive } from './live';
import { backupSnapshot, flush, getPersistenceHealth, loadSnapshot, saveNow, scheduleSave } from './store';
import { PlayerAuth } from './player-auth';
import {
  mergeBodyDigest,
  bodyDigest,
  type AuthAction,
  type DeviceProof,
  type PublicKeyJwk,
} from '../src/net/player-auth-protocol';
import * as anchor from './anchor';
import * as chat from './chat';
import * as tips from './tips';
import { claimMessage, mergeClaimMessage, verifyClaim, verifyMessage } from './attest';
import { levelFacts, refuse } from './verify';

const PORT = Number(process.env.PORT ?? 8790);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS ?? '', IS_PRODUCTION);
/** Set this when running behind Caddy or any proxy, or rate limits key on it. */
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/**
 * Where anchored runs are sent, and which chain counts.
 *
 * Both come from the environment because they are deployment facts, not code:
 * the address is a wallet somebody owns, and the network id is a number the
 * library's types do not expose. An unset address turns anchoring off and the
 * route says so, which is better than accepting transactions with nothing to
 * check their recipient against.
 */
const ANCHOR_ADDRESS = process.env.ANCHOR_ADDRESS ?? '';

/**
 * Default 5, which is what a transaction built for Nimiq mainnet carries in
 * the library used here. Overridable because a wrong value refuses every anchor,
 * and the refusal logs the id it actually saw so the fix is one line.
 */
const ANCHOR_NETWORK_ID = Number(process.env.ANCHOR_NETWORK_ID ?? 5);

const app = express();
const playerAuth = new PlayerAuth();

if (TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  for (const [name, value] of Object.entries(apiSecurityHeaders())) res.setHeader(name, value);
  next();
});

// A mission payload is about 4KB. Nothing posted here is larger than a few
// hundred bytes, so the cap is generous and still refuses anything strange.
app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  const cors = corsDecision(req.headers.origin, ALLOWED_ORIGINS, IS_PRODUCTION);
  if (!cors.allowed) {
    res.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }
  if (cors.header) {
    res.setHeader('access-control-allow-origin', cors.header);
    if (cors.header !== '*') res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', `content-type, ${NETWORK_HEADER}`);

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Rate limiting ------------------------------------------------------------

const RATE_LIMIT_BUCKET_IDLE_MS = 10 * 60_000;
const RATE_LIMIT_SWEEP_MS = 60_000;
const buckets = new Map<string, RateLimitBucket>();
let lastBucketSweep = 0;

/** Token bucket, in memory. One box, one process, no need for anything more. */
function limit(perMinute: number, burst: number) {
  const refillPerMs = perMinute / 60_000;

  return (req: Request, res: Response, next: NextFunction): void => {
    /*
     * Keyed on the method as well as the path.
     *
     * GET /contests and POST /contests are the same path and wildly different
     * costs: reading the list is cheap and generous, opening one is neither.
     * Sharing a bucket meant a client that polled the list could exhaust its own
     * ability to create, and the tighter of the two limits silently governed
     * both. Reading something must never spend the budget for writing it.
     */
    const key = `${req.method}:${req.path}:${clientIp(req)}`;
    const now = Date.now();
    if (now - lastBucketSweep >= RATE_LIMIT_SWEEP_MS) {
      pruneRateLimitBuckets(buckets, now, RATE_LIMIT_BUCKET_IDLE_MS);
      lastBucketSweep = now;
    }
    const bucket = buckets.get(key) ?? { tokens: burst, updatedAt: now };

    bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      res.status(429).json({ error: 'Too many requests. Slow down.' });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
}

/**
 * The client address. Behind a proxy this must come from the trusted hop that
 * express resolves, never from a raw header, or anyone can spoof their way
 * past the limiter by setting x-forwarded-for themselves.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

async function provesActor(
  proof: DeviceProof,
  action: AuthAction,
  actorId: string,
  signedBody: unknown,
): Promise<boolean> {
  const verified = await playerAuth.verify({
    proof,
    action,
    bodyDigest: await bodyDigest(signedBody),
  });
  return verified.ok && verified.value.playerId === actorId;
}

// Schemas ------------------------------------------------------------------

const deviceId = z.string().regex(/^[0-9a-f]{16,64}$/i, 'Device id must be hex.');
const publicKeyJwk = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().min(1).max(100),
  y: z.string().min(1).max(100),
  key_ops: z.array(z.string()).optional(),
  ext: z.boolean().optional(),
});
const deviceProof = z.object({
  challengeId: z.string().min(1).max(128),
  publicKeyJwk,
  signature: z.string().regex(/^[0-9a-f]+$/i).max(1024),
});
const pilotName = z.string().min(1).max(32);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.');
const seed = z.string().min(1).max(120);
/** Nimiq addresses are NQ plus 34 base32 characters, spaces optional. */
const nimiqAddress = z
  .string()
  .transform((value) => value.replace(/\s/g, '').toUpperCase())
  .refine((value) => /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(value), 'Not a Nimiq address.');

/** Only https, and only a host X actually serves pictures from. */
const avatarUrl = z
  .string()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        ['pbs.twimg.com', 'abs.twimg.com'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }, 'Not an X image URL.');

const scoreBody = z.object({
  deviceId,
  name: pilotName,
  date: isoDate,
  seed,
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // The day's cast is eight. See ROSTER_SIZE in server/xsense.ts.
  facesExtracted: z.number().int().min(0).max(ROSTER_SIZE),
  attackersCleared: z.number().int().min(0).max(200),
  duration: z.number().min(0).max(board.MAX_DURATION),
  // Added with the profile. Optional so an older client keeps working.
  cachesTaken: z.number().int().min(0).max(40).optional(),
  relicTaken: z.boolean().optional(),
  extracted: z.boolean().optional(),
  stage: z.number().int().min(1).max(7).optional(),
  stageCleared: z.boolean().optional(),
  avatarUrl: avatarUrl.nullable().optional(),

  /*
   * The wallet's signature over this exact claim. Optional, because the board
   * has always accepted unsigned rows and a plain browser has no wallet to
   * sign with. A row that supplies one gets verified; a row that does not is
   * stored exactly as before and simply carries no address.
   */
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/).optional(),
});

/**
 * Signing a run that was already posted.
 *
 * Everything needed to rebuild the exact signed message, and nothing else. No
 * score is written from this and no profile is touched, so the fields that
 * would move a ranking are deliberately absent from the schema rather than
 * accepted and ignored.
 */
/** Opening a contest. The terms, and nothing that could move a result. */
const contestBody = z.object({
  deviceId,
  name: pilotName,
  avatarUrl: avatarUrl.nullable().optional(),
  // Where the host is paid if they win. Required for a staked contest, and
  // meaningless on a free one, so the shape allows absent rather than empty.
  address: nimiqAddress.nullable().optional(),
  kind: z.enum(['duel', 'clan', 'gauntlet']),
  stages: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  // Zero is allowed: a contest with nothing on it is a free pass, not a
  // missing stake. See the constant in server/contests.ts.
  stakeNim: z.number().int().min(contests.MIN_STAKE_NIM).max(contests.MAX_STAKE_NIM),
  seats: z.number().int().min(2).max(6),
  visibility: z.enum(['open', 'private']),
  /*
   * How long it stays open, in minutes. Absent means the rest of the UTC day.
   *
   * The band is checked here and clamped again in the store, which is not
   * belt and braces for its own sake: this schema rejects a bad request, and
   * the clamp is what caps a legitimate 24 hour request at the rollover when
   * the contest was opened at four in the afternoon.
   */
  openMinutes: z
    .number()
    .int()
    .min(contestRules.MIN_OPEN_MINUTES)
    .max(contestRules.MAX_OPEN_MINUTES)
    .nullable()
    .optional(),
});

const joinContestBody = z.object({
  deviceId,
  name: pilotName,
  avatarUrl: avatarUrl.nullable().optional(),
  address: nimiqAddress.nullable().optional(),
});

/** Reporting a settlement. The hash is a claim by the payer, not a proof. */
const contestPaidBody = z.object({
  deviceId,
  txHash: z.string().min(1).max(200),
});

const signBody = z.object({
  deviceId,
  date: isoDate,
  seed,
  stage: z.number().int().min(1).max(7),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/),
  signature: z.string().regex(/^[0-9a-fA-F]{128}$/),
});

/**
 * Anchoring a run. The transaction, and which run it is supposed to be for.
 *
 * The run fields are not trusted: they say which board row to look at, and the
 * transaction must independently carry the same values. Sending one run's
 * numbers with another run's transaction is exactly what verifyAnchor refuses.
 */
/**
 * A line in the room. The pilot is checked against a profile, never trusted.
 *
 * The text may be empty when a run is attached, because the card is the
 * message. `runDate` says which day to look up, and the row that is read is
 * always the sender's own: it cannot name another pilot, so there is nothing to
 * check beyond the date being a date.
 */
const chatBody = z.object({
  deviceId,
  text: z.string().max(chat.MAX_MESSAGE),
  runDate: isoDate.nullish(),
  /** The message being answered. Dropped by the store if it does not exist. */
  replyTo: z.string().max(64).nullish(),
});

/**
 * A tip somebody just tried to send.
 *
 * Nothing here decides whether money moved. The wallet does that, and this only
 * records that it was attempted so the other phone can be told. `state` is not
 * taken from the client either: the service works it out from whether the
 * recipient has ever proved a wallet.
 */
const tipBody = z.object({
  deviceId,
  to: deviceId,
  nim: z.number().positive().max(tips.MAX_TIP_NIM),
  /** Whatever the wallet handed back, when it handed anything back. */
  tx: z.string().max(2048).nullish(),
});

const anchorBody = z.object({
  deviceId,
  date: isoDate,
  seed,
  stage: z.number().int().min(1).max(7),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // Hex, and long enough to be a transaction rather than a typo. The real bound
  // is whether it parses, which anchor.ts does properly.
  /*
   * Whatever the wallet handed back, loosely bounded.
   *
   * It was a strict hex pattern for a serialized transaction, which refused
   * every real reply and told players their score had not been sent while the
   * transaction was already on its way. The shape is Nimiq Pay's to choose, so
   * the only thing checked here is that it is a plausible identifier at all;
   * what it actually is gets decided in anchor.ts.
   */
  receipt: z.string().min(16).max(8000),
  /** What the client thought it received. Diagnostic only, never trusted. */
  shape: z.string().max(60).optional(),
});

const createBody = z.object({
  deviceId,
  name: pilotName,
  address: nimiqAddress.nullable(),
  date: isoDate,
  seed,
  stakeNim: z.number().min(challenges.MIN_STAKE_NIM).max(challenges.MAX_STAKE_NIM),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // The same window a contest takes, from the same shared band. Absent means
  // the rest of the UTC day, which is as long as the seed lives anyway.
  openMinutes: z
    .number()
    .int()
    .min(contestRules.MIN_OPEN_MINUTES)
    .max(contestRules.MAX_OPEN_MINUTES)
    .nullable()
    .optional(),
});

const acceptBody = z.object({
  deviceId,
  name: pilotName,
  address: nimiqAddress.nullable(),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // Must match the challenge's seed, or the two players ran different levels.
  seed,
});

const ghostBody = z.object({
  deviceId,
  name: pilotName,
  seed,
  score: z.number().int().min(0).max(board.SCORE_CEILING),
  // The day's cast is eight. See ROSTER_SIZE in server/xsense.ts.
  facesExtracted: z.number().int().min(0).max(ROSTER_SIZE),
  // Length and alphabet only. The client's decoder is the real validator, and
  // it returns null rather than throwing on anything malformed.
  trace: z.string().min(8).max(ghosts.MAX_TRACE_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

const joinClanBody = z.object({
  deviceId,
  name: pilotName,
  // Null leaves the clan. The shape is enforced by clans.normaliseTag, which
  // also fixes case and stray whitespace rather than refusing them.
  tag: z.string().max(8).nullable(),
});

const decideClanBody = z.object({
  /** The owner. The service checks this against the record, not the caller. */
  deviceId,
  memberId: deviceId,
  approve: z.boolean(),
});

const mergeBody = z.object({
  /** The device record being retired. */
  from: deviceId,
  /** The account record it becomes part of. */
  into: deviceId,
  sourceProof: z
    .object({
      challengeId: z.string().min(1).max(128),
      publicKeyJwk,
      signature: z.string().regex(/^[0-9a-f]+$/i).max(1024),
    })
    .optional(),
  destinationProof: z.object({
    challengeId: z.string().min(1).max(128),
    publicKeyJwk,
    signature: z.string().regex(/^[0-9a-f]+$/i).max(1024),
  }),
  walletProof: z
    .object({
      publicKey: z.string().regex(/^[0-9a-f]+$/i).max(256),
      signature: z.string().regex(/^[0-9a-f]+$/i).max(512),
    })
    .optional(),
});

const unlockBody = z.object({
  deviceId,
  /** Reported, not verified. Same limitation as challenge settlement. */
  serializedTx: z.string().regex(/^[0-9a-f]+$/i).min(32).max(4096),
});

const settleBody = z.object({
  deviceId,
  /** A serialized Nimiq transaction, hex. Stored as reported, not verified. */
  serializedTx: z.string().regex(/^[0-9a-f]+$/i).min(32).max(4096),
});

// Routes -------------------------------------------------------------------

app.get('/health', (_req, res) => {
  const persistence = getPersistenceHealth();
  const capabilities = buildCapabilities({
    persistence: persistence.status === 'healthy',
    anchor: anchor.isAnchorAddress(ANCHOR_ADDRESS),
    xOAuth: xauth.xauthConfigured(),
    xRead: xpostsConfigured() && xusersConfigured(),
    xSense: xsenseConfigured(),
    signals: signals.xsignalsConfigured(),
    corsRestricted: ALLOWED_ORIGINS.length > 0,
    trustedProxy: TRUST_PROXY,
  });
  res.status(persistence.status === 'healthy' ? 200 : 503).json({
    ok: persistence.status === 'healthy',
    date: utcDate(),
    persistence,
    capabilities,
  });
});

app.post('/auth/player/register', limit(8, 2), async (req, res) => {
  const parsed = z.object({ publicKeyJwk }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  const registered = await playerAuth.register({
    publicKeyJwk: parsed.data.publicKeyJwk as PublicKeyJwk,
  });
  if (!registered.ok) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  scheduleSave(snapshot);
  res.json({ ok: true, playerId: registered.value.playerId });
});

app.post('/auth/player/challenge', limit(24, 8), async (req, res) => {
  const parsed = z.discriminatedUnion('action', [
    z.object({
      playerId: deviceId,
      action: z.literal('profile.merge'),
      claim: z.object({ from: deviceId, into: deviceId }),
    }),
    z.object({
      playerId: deviceId,
      action: z.enum([
        'chat.say', 'chat.edit', 'tips.report', 'tips.seen',
        'clan.join', 'clan.decide', 'contest.create', 'contest.join',
        'contest.settle', 'challenge.create', 'challenge.accept',
        'challenge.settle', 'signals.unlock', 'score.post', 'score.sign',
        'score.anchor', 'ghost.post',
      ]),
      bodyDigest: z.string().regex(/^[0-9a-f]{64}$/i),
    }),
  ]).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  const network = networkOf(req);
  const digest =
    parsed.data.action === 'profile.merge'
      ? await mergeBodyDigest({ ...parsed.data.claim, network })
      : parsed.data.bodyDigest;
  const issued = playerAuth.issueChallenge({
    playerId: parsed.data.playerId,
    action: parsed.data.action as AuthAction,
    bodyDigest: digest,
  });
  if (!issued.ok) {
    res.status(403).json({ ok: false, error: 'unauthorized' });
    return;
  }
  res.json({ ok: true, challenge: issued.value });
});

app.get('/mission/today', limit(120, 40), async (req, res) => {
  const mission = await getMission({ rehearsal: isRehearsal(req) });

  if (!mission) {
    // The client has a practice mission for exactly this case. Say so plainly
    // rather than shipping a fabricated chart.
    res.status(503).json({ error: 'The market is unreachable. Play the practice mission.' });
    return;
  }

  // Cache at the edge for five minutes. The payload only changes once a day,
  // and this is the endpoint every player hits on open.
  res.setHeader('cache-control', 'public, max-age=300');
  res.json({ ...mission.payload, stale: mission.stale });
});

/*
 * Registered before /board/:date on purpose. Express matches in declaration
 * order, so the parameterised route would otherwise capture "all-time" as a
 * date, fail the YYYY-MM-DD parse, and return 400 for a route that exists.
 */
/**
 * What to quote when somebody asks how many people used this.
 *
 * Public and unauthenticated because there is nothing private in it: three
 * counts, no names, no addresses. Wallets are counted only where a signature
 * proved one, so the number is smaller than the flattering version and cannot
 * be padded by anybody who feels like posting an address. See walletCount.
 */
/*
 * The room.
 *
 * ## Why the message carries only an id
 *
 * A posted message says who sent it and nothing else about them. The name, the
 * picture, the clan, the rank and the wallet are all read from that pilot's
 * profile when the room is served, so nobody can post under somebody else's
 * name by asking to, and a name change shows up on every line at once.
 *
 * It is also what makes tipping safe: the address a tip goes to is one this
 * service proved from a signature, never one that arrived attached to a
 * message.
 */
app.get('/chat', limit(240, 60), (req, res) => {
  const network = networkOf(req);
  const stored = chat.recent(network);

  /*
   * A posted run is resolved here, from the board, under the sender's own id.
   *
   * The message said which day. It did not say what happened, because a score
   * that arrived attached to a message is a number somebody typed, and the
   * entire point of putting a run in front of people who might tip it is that
   * it is the number the board is ranking.
   *
   * A row that has gone is not an error. A message lives a day and a board is
   * pruned on its own schedule, so a card can outlive the run it points at; the
   * room draws those as an ordinary line and says the run has aged out.
   */
  const messages = stored.map((message) => ({
    ...message,
    run: message.runDate ? board.runCard(network, message.runDate, message.pilotId) : null,
  }));

  /*
   * Everyone who has spoken, sent alongside rather than looked up one by one.
   *
   * The room needs a name and a picture for every line, and a hundred lines
   * from a dozen people is a dozen profiles. Sending them once as a map is the
   * difference between one small payload and a hundred repeated ones.
   */
  const people: Record<string, unknown> = {};
  for (const id of chat.speakers(network)) {
    const profile = profiles.get(id, network);
    if (!profile) continue;

    people[id] = {
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      clanTag: profile.clanTag,
      lifetimeFace: profile.lifetimeFace,
      // Only ever an address a signature proved. See the note above.
      address: profile.address,
    };
  }

  /*
   * Whether the pilot asking has a run to post, answered in the same request.
   *
   * The room needs this to decide whether the share button exists at all, and
   * the only honest source is the board. Asking here rather than in a second
   * call keeps a screen that refreshes every few seconds down to one request,
   * and means the button cannot be offered for a run that is not there.
   */
  const asking = String(req.query.deviceId ?? '');
  const today = utcDate();
  const canShare = asking.length > 0 && board.runCard(network, today, asking) !== null;

  res.json({ messages, people, you: { runDate: canShare ? today : null } });
});

app.post('/chat', limit(30, 10), async (req, res) => {
  const parsed = chatBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  const signedBody = {
    deviceId: body.deviceId,
    text: body.text,
    runDate: body.runDate ?? null,
    replyTo: body.replyTo ?? null,
  };
  const actor = await playerAuth.verify({
    proof: body.auth as DeviceProof,
    action: 'chat.say',
    bodyDigest: await bodyDigest(signedBody),
  });
  if (!actor.ok || actor.value.playerId !== body.deviceId) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  /*
   * You have to have played to speak.
   *
   * Not gatekeeping for its own sake: a room anybody can post into without ever
   * opening the game is a room that fills with people who are not playing it.
   * One run is the whole requirement, and it is checked against the profile
   * rather than asked of the client.
   */
  const profile = profiles.get(body.deviceId, network);
  if (!profile || profile.runs <= 0) {
    res.status(403).json({ error: 'Fly a run first. The room is for people playing.' });
    return;
  }

  /*
   * A run can only be posted if it is on the board.
   *
   * Checked before the message is kept rather than when the room is served, so
   * a share that cannot work fails in front of the person who tried it instead
   * of becoming a line with a hole in it that everybody else sees.
   */
  if (body.runDate && !board.runCard(network, body.runDate, body.deviceId)) {
    res.status(400).json({ error: 'That run is not on the board.' });
    return;
  }

  const result = chat.say({
    network,
    pilotId: body.deviceId,
    text: body.text,
    runDate: body.runDate ?? null,
    replyTo: body.replyTo ?? null,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json({
    ...result.value,
    run: result.value.runDate
      ? board.runCard(network, result.value.runDate, body.deviceId)
      : null,
  });
});

/**
 * Change a message already said.
 *
 * The service decides whose it is and whether the window has closed. Nothing
 * about ownership is taken from the request: the id on the stored message is
 * this service's own record of who said what.
 */
app.post('/chat/:id', limit(30, 10), async (req, res) => {
  const parsed = z
    .object({ deviceId, text: z.string().max(chat.MAX_MESSAGE), auth: deviceProof })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const actor = await playerAuth.verify({
    proof: parsed.data.auth as DeviceProof,
    action: 'chat.edit',
    bodyDigest: await bodyDigest({
      id: String(req.params.id ?? ''),
      deviceId: parsed.data.deviceId,
      text: parsed.data.text,
    }),
  });
  if (!actor.ok || actor.value.playerId !== parsed.data.deviceId) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = chat.edit({
    network,
    pilotId: parsed.data.deviceId,
    id: String(req.params.id ?? ''),
    text: parsed.data.text,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json({
    ...result.value,
    run: result.value.runDate
      ? board.runCard(network, result.value.runDate, parsed.data.deviceId)
      : null,
  });
});

/**
 * Tips.
 *
 * ## What these two routes are not
 *
 * They are not a payment path. No NIM passes through this service, it holds no
 * balance and it cannot stop a transaction. A tip goes wallet to wallet, is
 * approved in Nimiq Pay, and the chain is the receipt.
 *
 * What they do is carry the news. A tip is the only thing in this app that
 * happens entirely on somebody else's phone, so it is the only thing that
 * cannot be worked out on the device it needs to reach.
 *
 * ## Why the state is decided here
 *
 * Whether a tip could be sent at all depends on whether the recipient ever
 * proved a wallet, and that is this service's own record. Taking the client's
 * word for it would let a message claim money was sent that never could be.
 */
app.get('/tips', limit(120, 60), (req, res) => {
  const who = String(req.query.deviceId ?? '');
  if (who.length === 0) {
    res.status(400).json({ error: 'Who is asking?' });
    return;
  }

  const network = networkOf(req);
  const waiting = tips.inbox(network, who);

  // Only the senders of tips that were actually sent. A refused one names
  // nobody, on purpose, so its sender is not put on the wire either.
  const people: Record<string, unknown> = {};
  for (const id of tips.sendersFor(network, who)) {
    const profile = profiles.get(id, network);
    if (!profile) continue;
    people[id] = { name: profile.name, avatarUrl: profile.avatarUrl };
  }

  res.json({ tips: waiting, people });
});

app.post('/tips', limit(60, 60), async (req, res) => {
  const parsed = tipBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  if (!(await provesActor(body.auth as DeviceProof, 'tips.report', body.deviceId, {
    deviceId: body.deviceId, to: body.to, nim: body.nim, tx: body.tx ?? null,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  const recipient = profiles.get(body.to, network);
  if (!recipient) {
    res.status(404).json({ error: 'No such pilot.' });
    return;
  }

  const result = tips.record({
    network,
    from: body.deviceId,
    to: body.to,
    nim: body.nim,
    // The service's own record of a proved wallet, never the client's claim.
    state: recipient.address ? 'sent' : 'no-wallet',
    tx: body.tx ?? null,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(result.value);
});

/** Everything waiting has been seen. A watermark, so nothing half-marks. */
app.post('/tips/seen', limit(60, 60), async (req, res) => {
  const parsed = z.object({ deviceId, auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'tips.seen', parsed.data.deviceId, {
    deviceId: parsed.data.deviceId,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  tips.markSeen(networkOf(req), parsed.data.deviceId, Date.now());
  res.json({ ok: true });
});

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
  /*
   * The daily board ranks on today's best run, but a row still wants the
   * pilot's avatar, clan and lifetime total so it can carry a rank badge.
   * Merged here rather than duplicated into the board store, which only needs
   * to know about today.
   */
  // The board the caller is looking at, which is the one their client is on.
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

app.post('/board', limit(20, 10), async (req, res) => {
  const parsed = scoreBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const { auth: _auth, ...submitted } = body;
  if (!(await provesActor(body.auth as DeviceProof, 'score.post', body.deviceId, submitted))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  /*
   * Verify the signature, if there is one, and derive who signed.
   *
   * A bad signature is refused rather than quietly downgraded to an unsigned
   * row. Silently accepting it would mean a tampered claim still lands on the
   * board looking ordinary, and the player who sent a genuine one has no way
   * to tell their wallet failed to bind.
   *
   * The address is DERIVED from the public key. There is deliberately no
   * address field in the request: a client-supplied address is a claim about
   * a signature, whereas a derived one is the signature's author.
   */
  let address: string | null = null;
  /*
   * Kept, not just checked.
   *
   * Verifying and then discarding the signature leaves the board asserting that
   * a wallet signed, with nothing anyone else can use to confirm it. Storing it
   * makes the claim checkable by a stranger, offline, after we are gone. See
   * the Proof type in leaderboard.ts.
   */
  let proof: board.Proof | null = null;
  /** Set when a signature arrived and did not verify, so the reply can say so. */
  let signatureRefused = false;
  if (body.publicKey && body.signature) {
    const attested = verifyClaim({
      claim: {
        date: body.date,
        seed: body.seed,
        stage: body.stage ?? 1,
        score: body.score,
      },
      publicKey: body.publicKey,
      signature: body.signature,
    });

    /*
     * A signature that does not verify costs the signature, never the score.
     *
     * This used to refuse the whole post with a 422. The reasoning was that
     * silently downgrading a bad signature would let a tampered claim land
     * looking ordinary, and that half is still true. What it got wrong is the
     * price: a player who finished a real run, signed it in good faith, and hit
     * any quirk between their wallet and this check lost the entire run. Face,
     * board row, rank, all of it, with nothing they could do about it.
     *
     * That trade is backwards. A row with no signature is exactly what a plain
     * browser has always produced and the board has always accepted, and it is
     * marked as unsigned rather than passed off as attested, so nothing is
     * being smuggled through. Meanwhile the score, which is the thing the
     * player actually earned, is safe.
     *
     * Signing is a separate act now, on its own route, and it is retryable.
     * See POST /board/sign. That is where a signature belongs: something that
     * can fail and be tried again, rather than something that can take a run
     * down with it.
     */
    if (!attested) {
      signatureRefused = true;
      /*
       * Logged with enough to tell WHY, because nothing else can.
       *
       * Not one row in production has ever carried a signature. Either the
       * wallet never produced one, or every one it produced failed this check,
       * and from the outside those look identical: the score lands unsigned
       * either way and nobody is told anything.
       *
       * The message is what the service rebuilt and tried to verify against.
       * If the wallet signed something else, comparing that string to what the
       * client sent is the whole diagnosis. Public keys and signatures are
       * public by definition, so there is nothing here worth hiding.
       */
      console.warn(
        '[sface] signature refused',
        JSON.stringify({
          message: claimMessage({
            date: body.date,
            seed: body.seed,
            stage: body.stage ?? 1,
            score: body.score,
          }),
          publicKey: body.publicKey,
          signature: body.signature,
        }),
      );
    } else {
      address = attested.address;
      /*
       * Remembered on the profile as well as on the row.
       *
       * A daily row carries its own signature. Lifetime Face is the sum of
       * dozens of runs, so there is no single signature over it, and without
       * this the all-time board had no verification of any kind. Binding the
       * address here is the weaker claim that is still worth making: this
       * account has proved a wallet at least once.
       */
      profiles.bindAddress(body.deviceId, attested.address);
      proof = {
        publicKey: body.publicKey,
        signature: body.signature,
        seed: body.seed,
        stage: body.stage ?? 1,
      };
    }
  }

  /*
   * Check the claim against the level it was supposedly run on.
   *
   * The mission comes from the service's own cache, never from the request. A
   * caller who could supply the terrain could describe a level generous enough
   * to justify anything they claimed, which would make the whole check a
   * formality that validates the attacker's own homework.
   *
   * Skipped when the seed does not match today's: the service only holds one
   * day's mission, so it cannot rebuild yesterday's level to check against.
   * Those rows fall back to the old fixed bounds, which is what they had
   * before this existed.
   */
  const today = await getMission();
  if (today && today.payload.seed === body.seed) {
    const facts = levelFacts(today.payload, body.stage ?? 1);
    const impossible = facts && refuse(
      {
        seed: body.seed,
        stage: body.stage ?? 1,
        score: body.score,
        facesExtracted: body.facesExtracted,
        attackersCleared: body.attackersCleared,
        cachesTaken: body.cachesTaken ?? 0,
        duration: body.duration,
        extracted: body.extracted ?? false,
      },
      facts,
    );

    if (impossible) {
      res.status(422).json({ error: impossible });
      return;
    }
  }

  /*
   * Stamped with the network the client declared, never with anything the body
   * claims. A score can only land on the board it was played on, and the client
   * is trusted with this exactly because declaring testnet can only ever mean
   * less: no metered reads, and a row that stays off the mainnet board.
   *
   * ## Testnet lands, on its own board
   *
   * This used to return early for a rehearsal, above the verification, with a
   * comment claiming the whole path still ran. It did not: the signature was
   * never checked and the level was never rebuilt, so the one network that
   * exists to exercise those was the only one that skipped them.
   *
   * It also made two things the app says untrue. Testnet has its own board and
   * its own lifetime Face, keyed by network everywhere from server/leaderboard
   * to server/profiles, and none of it could ever fill because nothing was
   * written. The separation is what keeps free NIM out of a real rank; it was
   * never a reason to discard the rehearsal itself.
   */
  const result = board.submit({ ...body, network: networkOf(req), address, proof });
  if (!result.ok) {
    res.status(422).json({ error: result.reason });
    return;
  }

  /*
   * The board keeps the best run of the day; the profile adds every run.
   * Folded in here rather than behind a second call so a run cannot be
   * counted on one and missed on the other, which would show a player a rank
   * that disagrees with their own results screen.
   */
  /*
   * Contests are updated here rather than by a second call.
   *
   * A separate request is a second chance to fail: the score lands on the board
   * and the contest entry does not, so somebody has a run they can see and a
   * stake that does not know about it. In the same request they arrive together
   * or not at all.
   */
  sweepContests(networkOf(req));
  const justSettled = contests.recordScore({
    network: networkOf(req),
    now: Date.now(),
    pilotId: parsed.data.deviceId,
    date: parsed.data.date,
    seed: parsed.data.seed,
    stage: parsed.data.stage ?? 1,
    score: parsed.data.score,
  });

  /*
   * Write the debts once, at the moment a contest becomes settled.
   *
   * Here rather than in the store, because the store knows nothing about
   * profiles and should not: it answers who owes what, and the record of
   * whether people pay is a different question kept somewhere that outlives
   * the contest, which is pruned after two days.
   */
  for (const contest of justSettled) {
    for (const owed of contestRules.obligationsOf(contest)) {
      const who = contest.entrants.find((e) => e.id === owed.fromId);
      profiles.recordDebt(owed.fromId, who?.name ?? 'Pilot', networkOf(req));
    }
  }

  const profile = profiles.record({
    id: parsed.data.deviceId,
    name: parsed.data.name,
    // Stamped so the clan table can group profiles by chain. The id is already
    // scoped by network on the client; this is what lets a scan tell them apart.
    network: networkOf(req),
    avatarUrl: parsed.data.avatarUrl ?? null,
    score: parsed.data.score,
    rescued: parsed.data.facesExtracted,
    caches: parsed.data.cachesTaken ?? 0,
    relics: parsed.data.relicTaken ? 1 : 0,
    extracted: parsed.data.extracted === true,
    stage: parsed.data.stage,
    stageCleared: parsed.data.stageCleared === true,
  });

  /*
   * `signed` tells the client what actually happened to its signature.
   *
   * Absent from the reply is not the same as false: an older client that never
   * sent one gets neither field and has nothing to explain. A client that sent
   * one and sees `signed: false` can offer to try again, which is the whole
   * reason the score no longer dies with the signature.
   */
  res.json({
    rank: result.rank,
    profile,
    /*
     * Whether THIS run is the one on the board.
     *
     * The board keeps the best run of the day, so a later, worse run leaves the
     * earlier row in place. Anything that attaches to a row, which is what
     * anchoring does, can only attach to that one.
     *
     * Without this the client had no way to know, so it offered to write any
     * run onto the chain, took the fee, and only then found a row whose score
     * did not match. Reported with the fee already gone.
     */
    onBoard: board.bestScore(networkOf(req), body.date, body.deviceId) === body.score,
    ...(body.publicKey && body.signature
      ? { signed: !signatureRefused }
      : {}),
  });
});

/*
 * Clans. Three endpoints, no clan store, and no ownership model.
 *
 * Everything here is folded out of the profiles on demand, so a clan cannot
 * disagree with its own members. The reasoning, including why anyone is allowed
 * to join any tag, is at the top of server/clans.ts.
 */
/**
 * Bind a wallet to a run that is already on the board.
 *
 * ## Why this is separate from posting
 *
 * The wallet used to be asked to sign during the post, which meant the prompt
 * arrived unannounced, in the two seconds a player is reading their own score,
 * and could not be retried if it failed. Worse, it was asked whenever a wallet
 * was merely present, including when no account had ever been approved, so
 * inside Nimiq Pay it reliably failed.
 *
 * So the score posts first and always, and signing is a button afterwards.
 * That needs its own route, because re-posting would be refused by the board
 * (it only replaces on a better score) and would add the run's Face to the
 * lifetime profile a second time.
 *
 * Nothing here changes a ranking. It attaches proof to a row that already
 * exists, or refuses.
 */
/**
 * Write a run onto the chain, and prove it.
 *
 * ## What arrives, and what is believed
 *
 * The client posts the serialized transaction its wallet signed. Nothing it
 * says about that transaction is taken on trust, including which run it is for:
 * the expected data is rebuilt here from the row the board already holds, and
 * the transaction has to match it. The hash is computed from the bytes rather
 * than accepted, because a hash is a string and any string would do.
 *
 * See server/anchor.ts for the five fields that are checked and why leaving out
 * any one of them makes the other four decorative.
 *
 * ## Why this is refused rather than disabled when unconfigured
 *
 * Anchoring needs an address to send to. Without one there is nothing to check
 * a recipient against, so every transaction would either be accepted blindly or
 * rejected confusingly. Saying so plainly is better than either.
 */
app.post('/board/anchor', limit(20, 10), async (req, res) => {
  const parsed = anchorBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!anchor.isAnchorAddress(ANCHOR_ADDRESS)) {
    res.status(503).json({ error: 'Anchoring is not configured on this service.' });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  const { auth: _auth, ...anchored } = body;
  if (!(await provesActor(body.auth as DeviceProof, 'score.anchor', body.deviceId, anchored))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  // Testnet runs are verified and never written down, so there is no row to
  // anchor. Said plainly rather than returning a success nothing came of.
  if (network === 'test') {
    res.json({ ok: true, recorded: false, note: 'Testnet runs are not kept on the board.' });
    return;
  }

  /*
   * A full transaction if the wallet gave one, an identifier if it did not.
   *
   * Which of the two arrives is the wallet's decision, not ours, so both are
   * handled and the difference is recorded rather than hidden. See
   * reportedAnchor for what the weaker one is and is not worth.
   */
  const checked = anchor.looksLikeHash(body.receipt)
    ? anchor.reportedAnchor(body.receipt, profiles.get(body.deviceId, network)?.address ?? null)
    : anchor.verifyAnchor({
        serialized: body.receipt,
        claim: { date: body.date, seed: body.seed, stage: body.stage, score: body.score },
        anchorAddress: ANCHOR_ADDRESS,
        networkId: ANCHOR_NETWORK_ID,
      });

  /*
   * Logged whatever happens, because the shape is the open question.
   *
   * Nothing else can tell us what Nimiq Pay actually returns, and a player who
   * has already paid a fee should not have to keep paying to find out. One real
   * line here settles it.
   */
  console.warn(
    '[sface] anchor receipt',
    JSON.stringify({
      length: body.receipt.length,
      hash: anchor.looksLikeHash(body.receipt),
      accepted: checked.ok,
      shape: body.shape ?? null,
    }),
  );

  if (!checked.ok) {
    /*
     * Logged with the id the transaction actually carried.
     *
     * The numeric network ids are not in the library's type definitions, so the
     * expected one is configured. If it is wrong every anchor fails, and this
     * line is what turns that from a mystery into a one-line fix.
     */
    if (checked.observed !== undefined) {
      console.warn(
        '[sface] anchor on unexpected chain',
        JSON.stringify({ expected: ANCHOR_NETWORK_ID, observed: checked.observed }),
      );
    }
    res.status(422).json({ error: checked.reason });
    return;
  }

  // Only the strong path derives a sender from the transaction itself. A
  // reported one has nothing to bind, and binding a guess would be worse.
  if (checked.value.sender) profiles.bindAddress(body.deviceId, checked.value.sender);

  const result = board.attachAnchor({
    network,
    date: body.date,
    deviceId: body.deviceId,
    score: body.score,
    hash: checked.value.hash,
    address: checked.value.sender,
  });

  if (!result.ok) {
    res.status(404).json({ error: result.reason });
    return;
  }

  res.json({
    ok: true,
    recorded: true,
    hash: checked.value.hash,
    strength: checked.value.strength,
    already: result.already,
  });
});

app.post('/board/sign', limit(20, 10), async (req, res) => {
  const parsed = signBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const { auth: _auth, ...signed } = body;
  if (!(await provesActor(body.auth as DeviceProof, 'score.sign', body.deviceId, signed))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  // Testnet runs are verified and never written down, so there is no row to
  // sign. Said plainly rather than returning a success nothing came of.
  if (networkOf(req) === 'test') {
    res.json({ ok: true, recorded: false, note: 'Testnet runs are not kept on the board.' });
    return;
  }

  const attested = verifyClaim({
    claim: { date: body.date, seed: body.seed, stage: body.stage, score: body.score },
    publicKey: body.publicKey,
    signature: body.signature,
  });

  if (!attested) {
    // Same reasoning as the score route: this is the only way to learn whether
    // the wallet is signing something other than what we verify against.
    console.warn(
      '[sface] sign refused',
      JSON.stringify({
        message: claimMessage({
          date: body.date,
          seed: body.seed,
          stage: body.stage,
          score: body.score,
        }),
        publicKey: body.publicKey,
        signature: body.signature,
      }),
    );
    res.status(422).json({ error: 'That signature does not match the run it was sent with.' });
    return;
  }

  // Signing an old run binds the wallet too, so the ladder catches up with
  // somebody who proved a run days after flying it.
  profiles.bindAddress(body.deviceId, attested.address);

  const result = board.attachProof({
    network: networkOf(req),
    date: body.date,
    deviceId: body.deviceId,
    score: body.score,
    address: attested.address,
    proof: {
      publicKey: body.publicKey,
      signature: body.signature,
      seed: body.seed,
      stage: body.stage,
    },
  });

  if (!result.ok) {
    res.status(404).json({ error: result.reason });
    return;
  }

  res.json({ ok: true, recorded: true, address: attested.address });
});

/*
 * Contests ------------------------------------------------------------------
 *
 * The list is public and the terms are fixed at creation. Nothing here holds a
 * stake: settlement is wallet to wallet against an address on the payer's own
 * screen, exactly as challenges already work, so the worst a wrong answer here
 * can do is describe a result incorrectly.
 */

/**
 * Apply any deadlines that have passed, and record what they cost.
 *
 * Called at the top of every contest read and before a score is folded in, so
 * nobody is ever shown or allowed to act on a contest whose clock ran out while
 * the page was open. The debts are written here for the same reason they are
 * written after a score: the store reports the transition and the profile is
 * where a settlement record has to outlive the contest itself.
 */
function sweepContests(network: string): void {
  for (const contest of contests.expireDue(Date.now())) {
    for (const owed of contestRules.obligationsOf(contest)) {
      const who = contest.entrants.find((e) => e.id === owed.fromId);
      profiles.recordDebt(owed.fromId, who?.name ?? 'Pilot', network);
    }
  }
}

app.get('/contests', limit(120, 40), (req, res) => {
  sweepContests(networkOf(req));
  res.json(contests.list(networkOf(req)));
});

app.get('/contests/:id', limit(120, 40), (req, res) => {
  sweepContests(networkOf(req));
  const found = contests.get(String(req.params.id ?? ''), networkOf(req));
  if (!found.ok) {
    res.status(found.code).json({ error: found.reason });
    return;
  }
  res.json(contests.toPublic(found.value));
});

app.post('/contests', limit(12, 6), async (req, res) => {
  const parsed = contestBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);
  if (!(await provesActor(body.auth as DeviceProof, 'contest.create', body.deviceId, {
    deviceId: body.deviceId, name: body.name, avatarUrl: body.avatarUrl ?? null,
    address: body.address ?? null, kind: body.kind, stages: body.stages,
    stakeNim: body.stakeNim, seats: body.seats, visibility: body.visibility,
    openMinutes: body.openMinutes ?? null,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  /*
   * Pinned to the service's own mission, never to anything the client sent.
   *
   * Every entrant has to fly the identical level, and a caller who could name
   * the seed could open a contest on a level they had already learned. The date
   * and seed come from the same cache the daily board verifies against.
   */
  const mission = await getMission({ rehearsal: network === 'test' });
  if (!mission) {
    res.status(503).json({ error: 'No mission to pin a contest to right now.' });
    return;
  }

  // The clan comes from the profile, not the request. A contest that named a
  // clan the host is not in would credit a roster nobody on it agreed to enter.
  const profile = profiles.get(body.deviceId, network);
  const clanTag = profile?.clanTag ?? null;
  // And whether they run it, because entering a clan commits every member.
  const ownsClan = clanTag !== null && clans.detail(clanTag, network)?.ownerId === body.deviceId;

  const result = contests.create({
    network,
    hostId: body.deviceId,
    hostName: body.name,
    hostAvatarUrl: body.avatarUrl ?? null,
    hostAddress: body.address ?? null,
    hostClanTag: clanTag,
    hostOwnsClan: ownsClan,
    kind: body.kind,
    stages: body.stages,
    stakeNim: body.stakeNim,
    seats: body.seats,
    visibility: body.visibility,
    openMinutes: body.openMinutes ?? null,
    date: mission.payload.date,
    seed: mission.payload.seed,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(contests.toPublic(result.value));
});

app.post('/contests/:id/join', limit(20, 10), async (req, res) => {
  sweepContests(networkOf(req));
  const parsed = joinContestBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const body = parsed.data;
  if (!(await provesActor(body.auth as DeviceProof, 'contest.join', body.deviceId, {
    id: String(req.params.id ?? ''), deviceId: body.deviceId, name: body.name,
    avatarUrl: body.avatarUrl ?? null, address: body.address ?? null,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  // Ensured, because taking a seat is a perfectly reasonable first thing to do
  // and refusing somebody until they have posted a run would make an invite
  // look broken to exactly the person it was meant to bring in.
  const profile = profiles.ensure(body.deviceId, body.name, network);

  const result = contests.join({
    id: String(req.params.id ?? ''),
    network,
    pilotId: body.deviceId,
    name: body.name,
    avatarUrl: body.avatarUrl ?? null,
    address: body.address ?? null,
    clanTag: profile.clanTag,
    now: Date.now(),
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(contests.toPublic(result.value));
});

/**
 * Report that a debt was paid.
 *
 * The hash is recorded, never verified: this service has no Nimiq node, the
 * same as the challenge settlement it sits beside. It is published next to the
 * debt so the person who is owed can check it themselves, which is witnessing
 * rather than enforcement, and the screen says so in those words.
 */
app.post('/contests/:id/settled', limit(20, 10), async (req, res) => {
  const parsed = contestPaidBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'contest.settle', parsed.data.deviceId, {
    id: String(req.params.id ?? ''), deviceId: parsed.data.deviceId, txHash: parsed.data.txHash,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = contests.markPaid({
    id: String(req.params.id ?? ''),
    network: networkOf(req),
    pilotId: parsed.data.deviceId,
    txHash: parsed.data.txHash,
  });

  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  // The record of whether people settle, which is the only thing standing in
  // for an escrow this app was never able to build.
  profiles.recordSettlement(parsed.data.deviceId, networkOf(req));

  res.json(contests.toPublic(result.value));
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
    // Not an error. An empty tag is a clan waiting for its first member, and
    // the join screen wants to show it as available rather than as missing.
    res.json({ tag, face: 0, members: 0, bestScore: 0, topPilot: null, topPilotAvatar: null, roster: [], place: 0 });
    return;
  }

  res.json(found);
});

app.post('/clans/join', limit(12, 6), async (req, res) => {
  const parsed = joinClanBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'clan.join', parsed.data.deviceId, {
    deviceId: parsed.data.deviceId, name: parsed.data.name, tag: parsed.data.tag,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  // Null means leave. Anything else has to be a real tag, and a typo that
  // silently dropped someone out of their clan would be worse than a 400.
  const tag = parsed.data.tag === null ? null : clans.normaliseTag(parsed.data.tag);
  if (parsed.data.tag !== null && tag === null) {
    res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
    return;
  }

  const outcome = clans.join(
    parsed.data.deviceId,
    parsed.data.name,
    tag,
    Date.now(),
  );
  if (outcome.status === 'refused') {
    res.status(409).json({ error: outcome.reason });
    return;
  }

  // The profile goes back with the outcome so the client never has to guess
  // whether the tag took. On a request it has not, and the profile says so.
  res.json({
    outcome,
    profile:
      profiles.get(parsed.data.deviceId, networkOf(req)) ??
      profiles.blank(parsed.data.deviceId, parsed.data.name, networkOf(req)),
    pending: clans.pendingFor(parsed.data.deviceId),
  });
});

app.post('/clans/:tag/decide', limit(30, 15), async (req, res) => {
  const parsed = decideClanBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const tag = clans.normaliseTag(req.params.tag);
  if (!tag) {
    res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
    return;
  }
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'clan.decide', parsed.data.deviceId, {
    tag: String(req.params.tag ?? ''),
    deviceId: parsed.data.deviceId,
    memberId: parsed.data.memberId,
    approve: parsed.data.approve,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  const result = clans.decide(
    tag,
    parsed.data.deviceId,
    parsed.data.memberId,
    parsed.data.approve,
  );
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(clans.detail(tag, networkOf(req)));
});

/*
 * CT Signals. Who publicly engages a handle, and what they fly for.
 *
 * Public data only, computed on the fly and never stored. See the header of
 * server/xsignals.ts for why that posture matters and for the honest note on
 * what the payment does and does not buy.
 */
app.get('/signals/:handle', limit(20, 8), async (req, res) => {
  const handle = String(req.params.handle ?? '').replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
    res.status(400).json({ error: 'Not an X handle.' });
    return;
  }

  const asked = req.query.depth === 'full';
  const who = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  // Free when no treasury is configured: a paywall with nowhere to pay is a
  // dead end, not a business model.
  const paid = signals.treasury() === null || (who !== '' && signals.unlocked(who));
  const depth = asked && paid ? 'full' : 'glance';

  /*
   * CT Signals is the most expensive thing in here: two queries per read, per
   * handle, uncached by nature because it is about one person right now. A
   * testnet session declines it rather than spending, and says so, which is a
   * far better test result than a silently empty panel.
   */
  if (isRehearsal(req)) {
    res.json({
      handle,
      rehearsal: true,
      note: 'CT Signals reads live X, so it is off on testnet. Switch to mainnet for the real read.',
      priceNim: signals.SIGNALS_PRICE_NIM,
      treasury: signals.treasury(),
      unlocked: false,
    });
    return;
  }

  const out = await signals.readSignals(handle, depth);
  if (!out) {
    res.status(503).json({ error: 'Could not read X right now. Try later.' });
    return;
  }

  res.json({
    ...out,
    priceNim: signals.SIGNALS_PRICE_NIM,
    treasury: signals.treasury(),
    unlocked: paid,
  });
});

app.post('/signals/unlock', limit(12, 6), async (req, res) => {
  const parsed = unlockBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'signals.unlock', parsed.data.deviceId, {
    deviceId: parsed.data.deviceId, serializedTx: parsed.data.serializedTx,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  signals.grant(parsed.data.deviceId, parsed.data.serializedTx);
  res.json({ unlocked: true });
});

/**
 * Fold one proved identity into another.
 *
 * Public pilot ids are references, never bearer secrets. New identities prove
 * both keys. A wallet-bound legacy profile proves the source with the wallet
 * and the destination with its device key. Unbound legacy records stay
 * read-only because no secret exists that could establish ownership.
 */
app.post('/profile/merge', limit(12, 6), async (req, res) => {
  const parsed = mergeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const claim = { from: parsed.data.from, into: parsed.data.into, network };
  const bodyDigest = await mergeBodyDigest(claim);
  const destination = await playerAuth.verify({
    proof: parsed.data.destinationProof as DeviceProof,
    action: 'profile.merge',
    bodyDigest,
  });
  if (!destination.ok || destination.value.playerId !== parsed.data.into) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }

  if (playerAuth.hasCredential(parsed.data.from)) {
    if (!parsed.data.sourceProof) {
      res.status(403).json({ error: 'unauthorized' });
      return;
    }
    const source = await playerAuth.verify({
      proof: parsed.data.sourceProof as DeviceProof,
      action: 'profile.merge',
      bodyDigest,
    });
    if (!source.ok || source.value.playerId !== parsed.data.from) {
      res.status(403).json({ error: 'unauthorized' });
      return;
    }
  } else {
    const sourceProfile = profiles.get(parsed.data.from, network);
    if (!sourceProfile?.address || !parsed.data.walletProof) {
      res.status(409).json({ error: 'legacy_profile_read_only' });
      return;
    }
    const verified = verifyMessage({
      message: mergeClaimMessage(claim),
      ...parsed.data.walletProof,
    });
    if (!verified || verified.address !== sourceProfile.address) {
      res.status(403).json({ error: 'unauthorized' });
      return;
    }
  }

  const merged = profiles.merge(parsed.data.from, parsed.data.into, network);
  if (!merged) {
    // Neither side has ever finished a run. Nothing to do, and not a failure.
    res.json({ merged: false });
    return;
  }

  res.json({ merged: true, profile: merged });
});

app.get('/profile/:id', limit(60, 20), (req, res) => {
  const id = deviceId.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: 'Bad pilot id.' });
    return;
  }

  /*
   * Scoped to the caller's chain.
   *
   * This is the card that shows Face, rank and campaign progress, and those are
   * per chain. Reading it network-blind would show a mainnet total to somebody
   * looking at their testnet profile, which is the pooling the split exists to
   * prevent, surfacing in the one place a player actually reads.
   */
  const network = networkOf(req);
  const profile = profiles.get(id.data, network);
  if (!profile) {
    // Not an error. A pilot who has never finished a run has a real, empty
    // profile, and returning 404 would make the client special-case day one.
    res.json(profiles.blank(id.data, 'Pilot', network));
    return;
  }

  /*
   * Runs on the board that nobody signed.
   *
   * Sent with the profile rather than behind a route of its own, because the
   * profile screen is the only place that asks and a second request would be a
   * second thing to fail on a page that already loads.
   */
  res.json({
    ...profile,
    allTimeRank: profiles.rankOf(id.data, network),
    unsigned: board.unsignedFor(network, id.data),
  });
});

/*
 * X connect. Three endpoints and no session anywhere.
 *
 * /x/start hands the browser an authorize URL. X calls /x/callback with a
 * code, we exchange it server-side because the client secret cannot live in a
 * bundle, and we hand the profile straight back to the page that opened the
 * flow. Nothing about the account is stored. See the header of server/xauth.ts.
 */
app.get('/x/config', (_req, res) => {
  res.json({ enabled: xauth.xauthConfigured() });
});

app.post('/x/start', limit(20, 8), (req, res) => {
  /*
   * Where to send them back to, checked against the allow list.
   *
   * Never taken on trust. An open redirect on an OAuth callback is how you
   * hand somebody else's authorisation to a site of your choosing, so an
   * origin that is not one of ours is refused outright rather than quietly
   * replaced with a default.
   */
  const asked = typeof req.body?.returnTo === 'string' ? req.body.returnTo : '';
  const returnTo = ALLOWED_ORIGINS.includes(asked) ? asked : (ALLOWED_ORIGINS[0] ?? '');

  if (!returnTo) {
    res.status(500).json({ error: 'No allowed origin is configured.' });
    return;
  }

  const result = xauth.begin(returnTo);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }
  res.json(result.value);
});

app.get('/x/callback', limit(30, 12), async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';

  // The user declined on X's own screen. Not an error, just a no.
  if (typeof req.query.error === 'string') {
    handOff(res, xauth.returnAddress(state), { ok: false, reason: 'declined' });
    return;
  }

  if (!state || !code) {
    handOff(res, null, { ok: false, reason: 'bad_request' });
    return;
  }

  // Read before complete(), which consumes the flow.
  const returnTo = xauth.returnAddress(state);

  const result = await xauth.complete(state, code);
  const payload = result.ok
    ? { ok: true as const, profile: result.value }
    : { ok: false as const, reason: result.reason };

  handOff(res, returnTo, payload);
});

/**
 * Send the browser back to the app with the result.
 *
 * ## Why this is a redirect and no longer a popup
 *
 * The old flow opened a popup and handed the result back by postMessage. That
 * works on a desktop and fails on the device this game is actually for. Mobile
 * browsers refuse a blank popup that is navigated after an await, and inside
 * Nimiq Pay's WebView window.open either does nothing or escapes to the system
 * browser, which then has no opener to post a message to. Connect X was simply
 * dead on every phone.
 *
 * The result rides in the URL FRAGMENT, not the query string. A fragment is
 * never sent to a server, so it stays out of access logs and out of any proxy
 * in between, which is the right handling for somebody's account details even
 * though every field in them is public.
 *
 * The popup page is kept below for the case where an opener really is there,
 * so a desktop flow already in progress is not broken by this change.
 */
function handOff(res: Response, returnTo: string | null, payload: unknown): void {
  const target = returnTo ?? ALLOWED_ORIGINS[0] ?? '';

  if (!target) {
    res.type('html').send(closingPage(payload));
    return;
  }

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  res.redirect(302, `${target}/#sface-x=${encoded}`);
}

/**
 * The old popup page, kept for a flow that genuinely has an opener.
 *
 * The payload is JSON-encoded into a script tag, so `<` is escaped: a display
 * name is attacker-controlled text and this is the one place it is inlined
 * into a document rather than set with textContent.
 */
function closingPage(payload: unknown): string {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const origin = ALLOWED_ORIGINS[0] ?? '*';

  return `<!doctype html><meta charset="utf-8"><title>sFace</title>
<body style="background:#f4ede0;color:#14110e;font:600 15px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>You can close this window.</p>
<script>
  (function () {
    var payload = ${json};
    try { window.opener && window.opener.postMessage({ source: 'sface-x', payload: payload }, ${JSON.stringify(origin)}); } catch (e) {}
    setTimeout(function () { window.close(); }, 400);
  })();
</script>`;
}

app.get('/ghosts', limit(60, 20), (req, res) => {
  const parsed = seed.safeParse(req.query.seed);
  if (!parsed.success) {
    res.status(400).json({ error: 'Bad seed.' });
    return;
  }

  const limitRaw = Number(req.query.limit ?? 4);
  const count = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 8) : 4;
  const exclude = typeof req.query.exclude === 'string' ? req.query.exclude : undefined;

  res.json(ghosts.top(parsed.data, count, exclude));
});

// Traces are the largest thing anyone posts, so this gets the tightest bucket.
app.post('/ghosts', limit(8, 4), async (req, res) => {
  const parsed = ghostBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const { auth: _auth, ...ghost } = parsed.data;
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'ghost.post', parsed.data.deviceId, ghost))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = ghosts.submit(ghost);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(result.value);
});

app.post('/challenges', limit(12, 6), async (req, res) => {
  const parsed = createBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const { auth: _auth, ...created } = parsed.data;
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'challenge.create', parsed.data.deviceId, created))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = challenges.create(created);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.status(201).json(challenges.toPublic(result.value));
});

app.get('/challenges/:id', limit(120, 40), (req, res) => {
  const result = challenges.get(String(req.params.id));
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }
  res.json(challenges.toPublic(result.value));
});

app.post('/challenges/:id/accept', limit(20, 10), async (req, res) => {
  const parsed = acceptBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const { auth: _auth, ...accepted } = parsed.data;
  if (!(await provesActor(parsed.data.auth as DeviceProof, 'challenge.accept', parsed.data.deviceId, {
    id: String(req.params.id ?? ''), ...accepted,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = challenges.accept(String(req.params.id), accepted);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }
  res.json(challenges.toPublic(result.value));
});

app.post('/challenges/:id/settled', limit(20, 10), async (req, res) => {
  const parsed = settleBody.extend({ auth: deviceProof }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  if (!(await provesActor(parsed.data.auth as DeviceProof, 'challenge.settle', parsed.data.deviceId, {
    id: String(req.params.id ?? ''), deviceId: parsed.data.deviceId,
    serializedTx: parsed.data.serializedTx,
  }))) {
    res.status(403).json({ error: 'unauthorized' });
    return;
  }
  const result = challenges.reportSettlement(String(req.params.id), {
    deviceId: parsed.data.deviceId,
    serializedTx: parsed.data.serializedTx,
  });
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }
  res.json(challenges.toPublic(result.value));
});

app.use((_req, res) => {
  res.status(404).json({ error: 'No such endpoint.' });
});

// An express error handler needs all four parameters to be recognised as one.
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[sface] unhandled', error);
  res.status(500).json({ error: 'Something broke on our side.' });
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Bad request.';
}

// Boot ---------------------------------------------------------------------

function snapshot() {
  return {
    version: 1 as const,
    scores: board.serialise(),
    challenges: challenges.serialise(),
    mission: daily.serialise(),
    profiles: profiles.serialise(),
    ghosts: ghosts.serialise(),
    clans: clans.serialise(),
    contests: contests.serialise(),
    chat: chat.serialise(),
    tips: tips.serialise(),
    signals: signals.serialise(),
    playerAuth: playerAuth.serialise(),
  };
}

async function main(): Promise<void> {
  const loaded = await loadSnapshot();
  if (!loaded.ok) {
    throw new Error(`Persistence startup failed: ${loaded.error}. Refusing to boot with empty state.`);
  }
  const restored = loaded.value;
  if (restored) {
    board.restore(restored.scores);
    challenges.restore(restored.challenges);
    // Before the refresh loop starts, so today's frozen seed wins over a
    // recomposed one.
    daily.restore(restored.mission);
    profiles.restore((restored as { profiles?: unknown }).profiles);
    ghosts.restore((restored as { ghosts?: unknown }).ghosts);
    clans.restore((restored as { clans?: unknown }).clans);
    contests.restore((restored as { contests?: unknown }).contests);
    chat.restore((restored as { chat?: unknown }).chat);
    tips.restore((restored as { tips?: unknown }).tips);
    signals.restore((restored as { signals?: unknown }).signals);
    playerAuth.restore(restored.playerAuth);
    console.log('[sface] restored snapshot');

    /*
     * Put the new shape on disk once, deliberately, rather than whenever.
     *
     * Profiles used to hold their totals flat; they now hold one set per chain.
     * `restore` reads both, so nothing is broken without this, and the file
     * would convert itself the first time anybody posted a score anyway.
     *
     * Doing it here buys one thing worth having: the reading half stops being
     * load-bearing. While an old-shape file exists anywhere, that branch has to
     * survive every future edit, and deleting it as dead code would not throw.
     * It would read every profile as zeroes. Face gone, ranks gone, campaign
     * progress gone, no error anywhere.
     *
     * The original is copied aside first, because this is the one write that
     * replaces data with a shape that has never been on this disk. If the
     * backup cannot be made the migration does not happen: converting anyway,
     * with nothing to go back to, is the opposite of careful.
     */
    const legacy = profiles.legacyCount();
    if (legacy > 0) {
      const stamp = utcDate();
      const kept = await backupSnapshot(stamp);
      if (kept) {
        await saveNow(snapshot());
        console.log(
          `[sface] migrated ${legacy} profile${legacy === 1 ? '' : 's'} to per-chain totals, previous snapshot kept at ${kept}`,
        );
      } else {
        console.error('[sface] skipped profile migration: could not back up the snapshot');
      }
    }
  }

  board.onChange(() => scheduleSave(snapshot));
  challenges.onChange(() => scheduleSave(snapshot));
  daily.onChange(() => scheduleSave(snapshot));
  profiles.onChange(() => scheduleSave(snapshot));
  ghosts.onChange(() => scheduleSave(snapshot));
  clans.onChange(() => scheduleSave(snapshot));
  contests.onChange(() => scheduleSave(snapshot));
  chat.onChange(() => scheduleSave(snapshot));
  tips.onChange(() => scheduleSave(snapshot));
  signals.onChange(() => scheduleSave(snapshot));

  startRefreshLoop();

  // Housekeeping. Old boards and dead challenges are not worth keeping.
  const housekeeping = setInterval(
    () => {
      board.prune(utcDate());
      challenges.prune();
      contests.expireDue(Date.now());
      contests.prune(Date.now());
      chat.prune(Date.now());
      tips.prune(Date.now());
      signals.pruneUnlocks();
      // Traces are the bulkiest thing stored and a seed is only playable on
      // its own day, so everything but today's room goes.
      void getMission().then((mission) => {
        ghosts.prune(mission ? [mission.payload.seed] : []);
      });
    },
    6 * 3_600_000,
  );
  housekeeping.unref?.();

  const server = app.listen(PORT, () => {
    console.log(`[sface] listening on :${PORT}`);
    console.log('[sface] live co-op relay on /live');
    if (!IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) {
      console.warn('[sface] ALLOWED_ORIGINS is unset. Development CORS allows every origin.');
    }
    if (!TRUST_PROXY) {
      console.warn('[sface] TRUST_PROXY is not true. Set it when running behind Caddy.');
    }
  });

  // The relay shares the http server, so one port and one Caddy rule covers
  // both. It upgrades only on /live and ignores every other path.
  attachLive(server);

  /*
   * listen() reports failures by emitting 'error' on the http server, not by
   * throwing. Without a handler, a port clash on restart is an unhandled event
   * and twenty lines of stack trace in the service log. The operator needs one
   * line and a non-zero exit code so the supervisor can act on it.
   */
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[sface] port ${PORT} is already in use. Is another copy running?`);
    } else {
      console.error(`[sface] could not listen on ${PORT}:`, error.message);
    }
    process.exit(1);
  });

  // Flush the snapshot before dying, or the last few scores go with it.
  const shutdown = (signal: string) => async () => {
    console.log(`[sface] ${signal}, shutting down`);
    server.close();
    await flush();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[sface] startup failed:', message);
  process.exitCode = 1;
});
