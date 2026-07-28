/**
 * The premise, the ladder, and the words that carry them.
 *
 * Voice rules, enforced here because this is the file most likely to drift
 * back toward marketing copy:
 *
 *   - Short declaratives. No em dashes, no semicolons doing an em dash's job.
 *   - Dry, never grim. The joke is that everyone is very calm about a
 *     catastrophe. Nothing here is breathless and nothing has an exclamation
 *     mark in it.
 *   - No inflated simile. Contracts do not flicker like dying stars, they just
 *     keep running with nobody watching, which is worse and also true.
 *   - Never claim anything about a real person's money, health or legal
 *     exposure. The Collapse is a setting, not an accusation.
 *
 * Face is the unit. Not points, not score. Reputation with a value still
 * attached, which is the entire premise compressed into one word, and it is
 * why recovering a cache reads as meaningful rather than as loot.
 */

/**
 * The intro, in beats.
 *
 * Each beat is one screen and one spoken line. Cut from nine to five and less
 * than half the original word count, because the narration is what sets the
 * length of the intro and "zero to using the Mini App in under 60 seconds" is
 * a scored criterion in as many words.
 *
 * The saving had to come out of the script rather than out of the delivery.
 * Measured on the real engine, a beat costs about three seconds of start-up
 * latency before a word is spoken plus roughly a third of a second per word,
 * so fewer and shorter beats is the only lever that does not involve speeding
 * the voice up. Speeding it up would buy the same seconds and turn the one
 * atmospheric thing in the game into a disclaimer.
 *
 * The long version survives untouched in FULL_STORY below, which is what the
 * lore screen and the README use.
 */
export const INTRO_BEATS: readonly string[] = [
  'In 2026 crypto did not crash. It lost face.',

  'The market cracked. Projects went dark by the dozen. Most just stopped answering.',

  'What is left is the Face Collapse, and a residue called Face. Reputation with a value still attached, refusing to settle at zero.',

  'You are not a hero. You are someone who did not look away.',

  'Every day the market picks its worst casualty. That chart is the ground you fly. Someone has to save face.',
];

/** The long version, for the lore screen and the README. */
export const FULL_STORY = `In 2026 crypto did not crash. It lost face.

After the peaks of late 2025 the market cracked. Bitcoin slid into the sixties and kept going, and everything else followed it down. Capital left. Deals stopped. Projects went dark by the dozen: wallets, bridges, chains, exchanges, marketplaces. Some posted a note. Most just stopped answering.

The regulators went quiet in the way that means something. Sentiment settled into fear and stayed there. The people who had been loudest in the last cycle got defensive, then stopped posting. Everyone who had said we were still early scrolled past in silence.

It was not only a price collapse. It was a reputational one.

What was left behind is the Face Collapse. Abandoned contracts still running with nobody watching. Liquidity locked in pools that no longer have an exit. Roadmaps that became evidence. All of it holding a residue: Face. Reputation with a value still attached, refusing to settle at zero.

You go in and get it out.

You drop in under your own handle, with your own record attached, and it sits above your head while you work. You can tag friends in. Every run is a recovery and a reckoning at the same time.

The missions are the unfinished business of 2026. Clear a bridge that shut down before the residual capital evaporates. Pull people out of a project whose name still carries weight, and decide whether its Face is worth claiming or worth letting burn. Fly the wound the market actually left that day, because the terrain is that day's worst chart and the people in it are the ones who were actually being talked about.

Getting a cache out is not only a score. It is a record that somebody showed up after the narrative turned.

The question is short. Who saves face?

The builders who never sold the dream. The believers who stayed after the noise. The hunters who worked out that reputation was the last thing still worth taking. Or nobody, and the Collapse keeps the rest.

The market is down and hope is thin. Reputation is still contested.

Go in. Tag your squad. Take what is left.`;

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export interface Rank {
  tier: number;
  name: string;
  /** Lifetime Face required to reach it. */
  at: number;
}

/**
 * Eight tiers, not fifty.
 *
 * A ladder whose top nobody can see is not a target, it is a treadmill. These
 * are spaced so the first three arrive inside a session, the middle three take
 * a week of daily play, and the last two are genuinely rare.
 *
 * Rank is a record, never a power. Nothing unlocks, nothing gets easier, and a
 * day-one pilot flies the identical mission to a tier eight one. That is not a
 * shortcut: a daily seeded challenge only stays a fair bet if everyone is
 * given the same level.
 */
export const RANKS: readonly Rank[] = [
  { tier: 1, name: 'Scrap Runner', at: 0 },
  { tier: 2, name: 'Wreck Diver', at: 5_000 },
  { tier: 3, name: 'Face Saver', at: 20_000 },
  { tier: 4, name: 'Vault Cracker', at: 50_000 },
  { tier: 5, name: 'Red Veteran', at: 110_000 },
  { tier: 6, name: 'Deep Salvage', at: 220_000 },
  { tier: 7, name: 'Market Maker', at: 420_000 },
  { tier: 8, name: 'The Last Exit', at: 800_000 },
];

export interface RankProgress {
  rank: Rank;
  next: Rank | null;
  /** 0 to 1 through the current tier. 1 when there is nothing above. */
  fraction: number;
  /** Face still needed for the next tier, or 0 at the top. */
  remaining: number;
}

export function rankFor(lifetimeFace: number): RankProgress {
  const face = Math.max(0, Math.floor(lifetimeFace));

  let index = 0;
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (face >= (RANKS[i]?.at ?? 0)) {
      index = i;
      break;
    }
  }

  const rank = RANKS[index] as Rank;
  const next = RANKS[index + 1] ?? null;

  if (!next) return { rank, next: null, fraction: 1, remaining: 0 };

  const span = next.at - rank.at;
  const into = face - rank.at;

  return {
    rank,
    next,
    fraction: span > 0 ? Math.min(1, Math.max(0, into / span)) : 1,
    remaining: Math.max(0, next.at - face),
  };
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

export type CacheTier = 'sealed' | 'vault' | 'relic';

export interface CacheDef {
  tier: CacheTier;
  label: string;
  /** Face carried. Multiplied by the day's bounty like everything else. */
  face: number;
  /** Radius the player must reach. Relics are small and mean it. */
  reach: number;
}

/**
 * Three tiers, and the difference between them is where they are, not what
 * they do. A sealed cache sits slightly off the line. A vault is somewhere you
 * would not fly unless you meant to. A relic is one per day, in the worst
 * place on the chart.
 *
 * Deliberately generic. A cache is anonymous residue, never a named person's
 * lost money: attributing funds to a real handle is a claim about their
 * finances and it is not ours to make. The roster carries handles, the caches
 * carry nothing.
 */
export const CACHES: Record<CacheTier, CacheDef> = {
  sealed: { tier: 'sealed', label: 'Sealed cache', face: 250, reach: 34 },
  vault: { tier: 'vault', label: 'Frozen vault', face: 750, reach: 32 },
  relic: { tier: 'relic', label: 'Relic', face: 2_000, reach: 30 },
};

/** One line on pickup. Dry, and never about anyone in particular. */
export const CACHE_LINES: Record<CacheTier, readonly string[]> = {
  sealed: [
    'Still signed. Still worth something.',
    'Somebody meant to come back for this.',
    'Dust on it. Value under the dust.',
  ],
  vault: [
    'The exit was removed. The balance was not.',
    'Frozen since the shutdown notice.',
    'Nobody had the key. You did not need one.',
  ],
  relic: [
    "The last thing that project shipped.",
    'This one still carries weight.',
    'Recovered. On the record.',
  ],
};
