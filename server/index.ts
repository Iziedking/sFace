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

import * as daily from './daily';
import { getMission, startRefreshLoop, utcDate } from './daily';
import * as board from './leaderboard';
import * as challenges from './challenges';
import * as clans from './clans';
import * as contests from './contests';
import { ROSTER_SIZE } from './xsense';
import * as contestRules from '../src/data/contests';
import * as ghosts from './ghosts';
import * as signals from './xsignals';
import * as profiles from './profiles';
import * as xauth from './xauth';
import { attachLive } from './live';
import { backupSnapshot, flush, loadSnapshot, saveNow, scheduleSave } from './store';
import { claimMessage, verifyClaim } from './attest';
import { levelFacts, refuse } from './verify';

const PORT = Number(process.env.PORT ?? 8790);
/** Comma-separated list. Empty means allow any origin, which is fine for a
 *  public read-mostly service but should be set in production. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
/** Set this when running behind Caddy or any proxy, or rate limits key on it. */
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const app = express();

if (TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');

// A mission payload is about 4KB. Nothing posted here is larger than a few
// hundred bytes, so the cap is generous and still refuses anything strange.
app.use(express.json({ limit: '16kb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length === 0) {
    res.setHeader('access-control-allow-origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  /*
   * Both headers the client actually sends, and no more.
   *
   * x-sface-network is a CUSTOM header, and a custom header is what turns a
   * simple request into a preflighted one. Leaving it out of this list does not
   * merely ignore it: the browser refuses the whole request, so every call fails
   * with a CORS error while the same URL answers fine from curl. That is a
   * confusing failure to debug and it would have taken the live site down the
   * moment the client started sending it.
   */
  res.setHeader('access-control-allow-headers', `content-type, ${NETWORK_HEADER}`);

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Rate limiting ------------------------------------------------------------

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

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

// Schemas ------------------------------------------------------------------

const deviceId = z.string().regex(/^[0-9a-f]{16,64}$/i, 'Device id must be hex.');
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
  res.json({ ok: true, date: utcDate() });
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
  const parsed = scoreBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;

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
app.post('/board/sign', limit(20, 10), (req, res) => {
  const parsed = signBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;

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
  const parsed = contestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const body = parsed.data;
  const network = networkOf(req);

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

app.post('/contests/:id/join', limit(20, 10), (req, res) => {
  sweepContests(networkOf(req));
  const parsed = joinContestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const network = networkOf(req);
  const body = parsed.data;
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
app.post('/contests/:id/settled', limit(20, 10), (req, res) => {
  const parsed = contestPaidBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
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

app.post('/clans/join', limit(12, 6), (req, res) => {
  const parsed = joinClanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
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

app.post('/clans/:tag/decide', limit(30, 15), (req, res) => {
  const parsed = decideClanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const tag = clans.normaliseTag(req.params.tag);
  if (!tag) {
    res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
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

app.post('/signals/unlock', limit(12, 6), (req, res) => {
  const parsed = unlockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  signals.grant(parsed.data.deviceId, parsed.data.serializedTx);
  res.json({ unlocked: true });
});

/**
 * Fold a device's record into an account's, on sign-in.
 *
 * Deliberately unauthenticated, and safe because of what it can and cannot do.
 * Both ids are opaque 64-character keys: one is a device identifier the caller
 * already holds, the other is derived from the handle they just proved they own
 * by completing the X sign-in. A caller can only ever merge a record they are
 * holding the key to, and merging is additive, so the worst outcome of a
 * dishonest call is that somebody donates their own runs to an account.
 *
 * It cannot be used to READ anything: the response is the merged profile, which
 * the caller now owns either way.
 */
app.post('/profile/merge', limit(12, 6), (req, res) => {
  const parsed = mergeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const merged = profiles.merge(parsed.data.from, parsed.data.into, networkOf(req));
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
app.post('/ghosts', limit(8, 4), (req, res) => {
  const parsed = ghostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const result = ghosts.submit(parsed.data);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(result.value);
});

app.post('/challenges', limit(12, 6), (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const result = challenges.create(parsed.data);
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

app.post('/challenges/:id/accept', limit(20, 10), (req, res) => {
  const parsed = acceptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const result = challenges.accept(String(req.params.id), parsed.data);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }
  res.json(challenges.toPublic(result.value));
});

app.post('/challenges/:id/settled', limit(20, 10), (req, res) => {
  const parsed = settleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: firstIssue(parsed.error) });
    return;
  }

  const result = challenges.reportSettlement(String(req.params.id), parsed.data);
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
    signals: signals.serialise(),
  };
}

async function main(): Promise<void> {
  const restored = await loadSnapshot();
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
    signals.restore((restored as { signals?: unknown }).signals);
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
  signals.onChange(() => scheduleSave(snapshot));

  startRefreshLoop();

  // Housekeeping. Old boards and dead challenges are not worth keeping.
  const housekeeping = setInterval(
    () => {
      board.prune(utcDate());
      challenges.prune();
      contests.expireDue(Date.now());
      contests.prune(Date.now());
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
    if (ALLOWED_ORIGINS.length === 0) {
      console.warn('[sface] ALLOWED_ORIGINS is unset, so every origin is allowed.');
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

void main();
