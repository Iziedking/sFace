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
import * as ghosts from './ghosts';
import * as signals from './xsignals';
import * as profiles from './profiles';
import * as xauth from './xauth';
import { attachLive } from './live';
import { flush, loadSnapshot, scheduleSave } from './store';
import { verifyClaim } from './attest';
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
    const key = `${req.path}:${clientIp(req)}`;
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
  facesExtracted: z.number().int().min(0).max(5),
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

const createBody = z.object({
  deviceId,
  name: pilotName,
  address: nimiqAddress.nullable(),
  date: isoDate,
  seed,
  stakeNim: z.number().min(challenges.MIN_STAKE_NIM).max(challenges.MAX_STAKE_NIM),
  score: z.number().int().min(0).max(board.SCORE_CEILING),
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
  facesExtracted: z.number().int().min(0).max(5),
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
app.get('/board/all-time', limit(120, 40), (_req, res) => {
  res.json(profiles.allTime(50));
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
  const rows = board.top(date.data).map((entry) => {
    const profile = profiles.get(entry.id);
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
   * A rehearsal is scored, checked and told the truth, then not written down.
   *
   * The submission still runs the whole path above and below this: the level is
   * rebuilt, the ceiling is enforced, the signature is verified. That is the
   * point of a test network, and stopping earlier would mean the one thing
   * testnet cannot exercise is the thing most worth exercising.
   *
   * What it does not do is land on the daily board. That board is a public
   * ranking with real stakes attached, and a row from a network where NIM is
   * free is not comparable to one from a network where it is not. Mixing them
   * would quietly devalue every honest entry.
   */
  if (networkOf(req) === 'test') {
    res.json({
      ok: true,
      recorded: false,
      network: 'test',
      note: 'Testnet run. Scored and verified, but kept off the mainnet board.',
    });
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

    if (!attested) {
      res.status(422).json({ error: 'That signature does not match the score it was sent with.' });
      return;
    }
    address = attested.address;
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

  const result = board.submit({ ...body, address });
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
  const profile = profiles.record({
    id: parsed.data.deviceId,
    name: parsed.data.name,
    avatarUrl: parsed.data.avatarUrl ?? null,
    score: parsed.data.score,
    rescued: parsed.data.facesExtracted,
    caches: parsed.data.cachesTaken ?? 0,
    relics: parsed.data.relicTaken ? 1 : 0,
    extracted: parsed.data.extracted === true,
    stage: parsed.data.stage,
    stageCleared: parsed.data.stageCleared === true,
  });

  res.json({ rank: result.rank, profile });
});

/*
 * Clans. Three endpoints, no clan store, and no ownership model.
 *
 * Everything here is folded out of the profiles on demand, so a clan cannot
 * disagree with its own members. The reasoning, including why anyone is allowed
 * to join any tag, is at the top of server/clans.ts.
 */
app.get('/clans', limit(120, 40), (_req, res) => {
  res.json(clans.table(50));
});

app.get('/clans/:tag', limit(120, 40), (req, res) => {
  const tag = clans.normaliseTag(req.params.tag);
  if (!tag) {
    res.status(400).json({ error: 'A clan tag is two to four letters or digits.' });
    return;
  }

  const found = clans.detail(tag);
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

  const outcome = clans.join(parsed.data.deviceId, parsed.data.name, tag, Date.now());
  if (outcome.status === 'refused') {
    res.status(409).json({ error: outcome.reason });
    return;
  }

  // The profile goes back with the outcome so the client never has to guess
  // whether the tag took. On a request it has not, and the profile says so.
  res.json({
    outcome,
    profile: profiles.get(parsed.data.deviceId) ?? profiles.blank(parsed.data.deviceId, parsed.data.name),
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

  const result = clans.decide(tag, parsed.data.deviceId, parsed.data.memberId, parsed.data.approve);
  if (!result.ok) {
    res.status(result.code).json({ error: result.reason });
    return;
  }

  res.json(clans.detail(tag));
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

  const merged = profiles.merge(parsed.data.from, parsed.data.into);
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

  const profile = profiles.get(id.data);
  if (!profile) {
    // Not an error. A pilot who has never finished a run has a real, empty
    // profile, and returning 404 would make the client special-case day one.
    res.json(profiles.blank(id.data, 'Pilot'));
    return;
  }

  res.json({ ...profile, allTimeRank: profiles.rankOf(id.data) });
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
    signals.restore((restored as { signals?: unknown }).signals);
    console.log('[sface] restored snapshot');
  }

  board.onChange(() => scheduleSave(snapshot));
  challenges.onChange(() => scheduleSave(snapshot));
  daily.onChange(() => scheduleSave(snapshot));
  profiles.onChange(() => scheduleSave(snapshot));
  ghosts.onChange(() => scheduleSave(snapshot));
  clans.onChange(() => scheduleSave(snapshot));
  signals.onChange(() => scheduleSave(snapshot));

  startRefreshLoop();

  // Housekeeping. Old boards and dead challenges are not worth keeping.
  const housekeeping = setInterval(
    () => {
      board.prune(utcDate());
      challenges.prune();
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
