/**
 * Checking a claimed run against the level it claims to have been run on.
 *
 * ## Why this is possible here and is not possible in most games
 *
 * sFace levels are deterministic. The seed is public, it is in the submission,
 * and feeding it to the same constructor the client used produces a
 * byte-identical level. So the service does not have to guess whether 40 kills
 * is a lot: it can build the level and observe that it contains 18 attackers.
 *
 * That turns every bound from a judgement call into a fact about a specific
 * level, which is a different class of check entirely. The old ceiling was
 * "nobody scores above 60,000"; the new one is "this seed cannot pay more than
 * 9,240, so 12,000 did not happen".
 *
 * ## What this still does not do
 *
 * It does not prove the run happened. A forged submission that is internally
 * consistent AND fits inside the level's real contents is still accepted. Full
 * proof needs input-trace replay, and that has a trap worth writing down: the
 * ECMAScript spec leaves Math.sin, Math.cos and Math.pow implementation
 * defined. Node is V8; Nimiq Pay on iOS is a WKWebView, which is
 * JavaScriptCore. A legitimate iPhone run could replay to a slightly different
 * score and be rejected as a forgery, and falsely accusing an honest player is
 * worse than the cheating it prevents. Fix the maths before attempting replay.
 *
 * Together with the wallet signature in attest.ts, a cheat now has to be
 * internally consistent, physically possible on that exact seed, and signed
 * from an address that wears it publicly and permanently.
 */

import { RunState } from '../src/game/state';
import { ATTACKER_SCORE, TIME_BONUS_PER_SECOND } from '../src/game/state';

import { parseMission } from '../src/game/mission';
import { CACHES } from '../src/data/story';

export interface ClaimedRun {
  seed: string;
  stage: number;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  cachesTaken: number;
  duration: number;
  extracted: boolean;
}

/** What the level actually contains, and therefore the most it can pay. */
export interface LevelFacts {
  enemies: number;
  caches: number;
  faces: number;
  seconds: number;
  maxScore: number;
}

/**
 * Build the level and read off its limits.
 *
 * The mission is the service's own copy, never the client's: taking the terrain
 * from the submission would let a caller describe a level generous enough to
 * justify whatever they claimed.
 */
export function levelFacts(payload: unknown, stage: number): LevelFacts | null {
  /*
   * Normalised through the client's own parser, not consumed raw.
   *
   * The service's payload carries a roster of handles and lines; the level
   * builder also needs each person's bounty and quirk, which parseMission
   * fills in from the archetypes. Building the level from the raw payload
   * would produce faces worth NaN and a ceiling that accepts anything.
   *
   * Using the client's parser has a second and better property: the service
   * now checks against precisely the level the client was given, rather than
   * against a near-copy that could drift apart from it.
   */
  const mission = parseMission(payload);
  if (!mission) return null;

  const run = new RunState(mission, undefined, stage);

  const bounties = run.faces.reduce((total, face) => total + face.bounty, 0);
  const caches = run.caches.reduce((total, cache) => total + CACHES[cache.tier].face, 0);

  /*
   * The perfect run: every attacker cleared, every cache taken, everyone
   * extracted, and the clock stopped the instant it began. Nobody will ever
   * reach it, which is the point of a ceiling.
   */
  const raw =
    bounties +
    caches +
    run.enemies.length * ATTACKER_SCORE +
    Math.floor(run.seconds * TIME_BONUS_PER_SECOND);

  const maxScore = Math.floor(
    raw * mission.bountyMultiplier * run.stage.bounty * CONTRACT_BONUS_CEILING,
  );

  return {
    enemies: run.enemies.length,
    caches: run.caches.length,
    faces: run.faces.length,
    seconds: run.seconds,
    maxScore,
  };
}

/**
 * The best multiplier all three of today's contracts can produce.
 *
 * Kept as a constant rather than derived, because contracts are generated from
 * the same seed and re-deriving them here would couple the verifier to the
 * contract generator for a number that only ever moves the ceiling up.
 */
const CONTRACT_BONUS_CEILING = 2;

/**
 * Check a claim against the level. Returns a reason to refuse it, or null.
 *
 * Every message says what was impossible without saying what would have been
 * accepted. "Kill count is above what this level contains" tells an honest
 * player their client is broken; it does not hand a dishonest one the ceiling.
 */
export function refuse(claim: ClaimedRun, facts: LevelFacts): string | null {
  if (claim.attackersCleared > facts.enemies) {
    return 'Kill count is above what this level contains.';
  }
  if (claim.cachesTaken > facts.caches) {
    return 'Cache count is above what this level contains.';
  }
  if (claim.facesExtracted > facts.faces) {
    return 'Rescue count is above what this level contains.';
  }
  // One second of slack for the frame the run ended on.
  if (claim.duration > facts.seconds + 1) {
    return 'Run lasted longer than the stage allows.';
  }
  if (claim.score > facts.maxScore) {
    return 'Score is above what this level can pay.';
  }
  /*
   * Extraction is the only way to earn the time bonus, so a run that did not
   * extract cannot have been paid for the clock. Cheap to check and it closes
   * the laziest way to inflate a score without touching any of the counts.
   */
  if (!claim.extracted && claim.facesExtracted > 0) {
    return 'Faces cannot be extracted by a run that did not extract.';
  }
  return null;
}
