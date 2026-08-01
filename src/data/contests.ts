/**
 * Contests: the shapes every screen and route agrees on.
 *
 * A challenge used to be one thing, between two people, on one stage. This is
 * the same idea with the three knobs a real contest needs: who can enter, how
 * many stages it runs over, and how the winner is decided.
 *
 * Kept as data and pure functions with no DOM and no network, for the same
 * reason src/game is: the service has to compute a standing the identical way
 * the client displays one. Two implementations of "who won" that disagree is a
 * settlement dispute, and there is NIM on some of these.
 *
 * ## The three kinds
 *
 *   duel      People against people. Everyone flies the same seeded stages and
 *             the best average wins. Two to six seats.
 *
 *   clan      Clans against clans. Every member who flies contributes, and a
 *             clan is scored on the average of its members rather than the sum,
 *             so a big clan cannot win by turning up in numbers.
 *
 *   gauntlet  Survival. One shared seed, hideouts and pickups, and you are
 *             racing everyone else's clock rather than shooting at them. See
 *             the note on why it is asynchronous at the bottom of this file.
 *
 * ## Average, never best
 *
 * A multi stage contest settles on the mean of the stages entered. Best-of was
 * the obvious alternative and it is wrong: it lets one lucky stage carry a
 * player who was worse across the rest, and these settle for money. The mean
 * asks who was better over the whole thing, which is the question being bet on.
 */

/** How many stages the campaign has. Contests can never exceed it. */
export const MAX_STAGE = 7;

/** Seats a duel can hold, counting whoever opened it. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 6;

export type ContestKind = 'duel' | 'clan' | 'gauntlet';

export type ContestStatus =
  /** Open for entrants. Still has seats, or is waiting for a clan to answer. */
  | 'open'
  /** Full, and being flown. */
  | 'running'
  /** Everyone who is going to fly has flown. A winner exists. */
  | 'settled';

export type ContestVisibility =
  /** Listed publicly, anybody may take a seat. */
  | 'open'
  /** Reachable only by its link. Never appears in the list. */
  | 'private';

export interface ContestEntrant {
  id: string;
  name: string;
  avatarUrl: string | null;
  clanTag: string | null;
  /**
   * Score per stage, keyed by stage number.
   *
   * Sparse on purpose. A partial entry is a real state: somebody who has flown
   * two of three stages is neither finished nor absent, and the standings have
   * to be able to say so rather than treating them as a zero.
   */
  scores: Record<number, number>;
}

export interface Contest {
  id: string;
  kind: ContestKind;
  /** Stage numbers, ascending. Always at least one. */
  stages: number[];
  stakeNim: number;
  seats: number;
  visibility: ContestVisibility;
  status: ContestStatus;
  /** The day and level this contest is pinned to. Everyone flies the same one. */
  date: string;
  seed: string;
  hostId: string;
  hostName: string;
  hostAvatarUrl: string | null;
  /** Set on a clan contest: the clan that opened it. Null otherwise. */
  clanTag: string | null;
  entrants: ContestEntrant[];
}

/**
 * A stage list from a range, inclusive both ends.
 *
 * Clamped rather than refused. The pickers cannot produce anything outside one
 * to seven, so anything that does is a bug elsewhere, and a contest that
 * silently corrects itself is better than one that throws while somebody is
 * staking on it.
 */
export function stageRange(from: number, to: number): number[] {
  const lo = Math.max(1, Math.min(MAX_STAGE, Math.round(from)));
  const hi = Math.max(1, Math.min(MAX_STAGE, Math.round(to)));
  const out: number[] = [];
  for (let n = Math.min(lo, hi); n <= Math.max(lo, hi); n++) out.push(n);
  return out;
}

/** How the stage list reads on a card. */
export function stagesLabel(stages: number[]): string {
  if (stages.length === 0) return 'No stages';
  if (stages.length === MAX_STAGE) return 'All seven stages';
  if (stages.length === 1) return `Stage ${stages[0]}`;

  // Contiguous runs read as a range; anything else is listed, because "1, 4, 6"
  // written as "1 to 6" would be a lie about what has to be flown.
  const contiguous = stages.every((n, i) => i === 0 || n === (stages[i - 1] ?? 0) + 1);
  if (contiguous) return `Stages ${stages[0]} to ${stages[stages.length - 1]}`;
  return `Stages ${stages.join(', ')}`;
}

export const KIND_LABEL: Record<ContestKind, string> = {
  duel: 'Head to head',
  clan: 'Clan contest',
  gauntlet: 'Last one flying',
};

export const KIND_SAY: Record<ContestKind, string> = {
  duel: 'Everyone flies the same stages. Best average takes it.',
  clan: 'Clan against clan, scored on the average of whoever turns up.',
  gauntlet: 'One shared level, hideouts and pickups, and a clock nobody survives.',
};

/** Seats still free. Never negative, however the entrant list arrived. */
export function seatsLeft(contest: Contest): number {
  return Math.max(0, contest.seats - contest.entrants.length);
}

/** Stages this entrant still has to fly. */
export function remainingFor(contest: Contest, entrant: ContestEntrant): number[] {
  return contest.stages.filter((n) => typeof entrant.scores[n] !== 'number');
}

export function hasFinished(contest: Contest, entrant: ContestEntrant): boolean {
  return remainingFor(contest, entrant).length === 0;
}

/**
 * An entrant's score, or null while they still have stages to fly.
 *
 * Null rather than a running average, because a partial mean is not comparable
 * to a complete one and showing them in the same column would rank somebody
 * ahead on the strength of the stages they have not attempted yet.
 */
export function averageFor(contest: Contest, entrant: ContestEntrant): number | null {
  if (!hasFinished(contest, entrant)) return null;
  if (contest.stages.length === 0) return null;

  const total = contest.stages.reduce((sum, n) => sum + (entrant.scores[n] ?? 0), 0);
  return Math.round(total / contest.stages.length);
}

export interface Standing {
  entrant: ContestEntrant;
  average: number | null;
  flown: number;
  of: number;
  /** 1-based, and only among those who have finished. Zero for everyone else. */
  place: number;
}

/**
 * The table, finished entrants first and ranked, everybody else after.
 *
 * Unfinished entrants are not interleaved by partial score. They are listed
 * below with how far through they are, which is the honest presentation: they
 * do not have a position yet, and giving them a provisional one invites reading
 * it as a result.
 */
export function standings(contest: Contest): Standing[] {
  const rows = contest.entrants.map((entrant) => ({
    entrant,
    average: averageFor(contest, entrant),
    flown: contest.stages.length - remainingFor(contest, entrant).length,
    of: contest.stages.length,
    place: 0,
  }));

  const done = rows
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0));

  done.forEach((row, index) => {
    row.place = index + 1;
  });

  const pending = rows
    .filter((r) => r.average === null)
    .sort((a, b) => b.flown - a.flown || a.entrant.name.localeCompare(b.entrant.name));

  return [...done, ...pending];
}

export interface ClanStanding {
  tag: string;
  /** Mean of the members who finished. Null until at least one has. */
  average: number | null;
  /** Members who have flown every stage, and members entered. */
  finished: number;
  entered: number;
  place: number;
}

/**
 * Clan against clan, on the mean rather than the total.
 *
 * The sum was the obvious version and it makes the contest a headcount: a clan
 * of thirty beats a clan of four on turnout alone, and the smaller clan cannot
 * do anything about it by playing better. The mean asks which roster flew
 * better, which is the thing the two clans actually agreed to settle.
 *
 * Only finished members count toward it. Half a run is not a score, and letting
 * an abandoned attempt drag a clan's mean down would make quitting an attack on
 * your own side.
 */
export function clanStandings(contest: Contest): ClanStanding[] {
  const byTag = new Map<string, { totals: number[]; entered: number }>();

  for (const entrant of contest.entrants) {
    const tag = entrant.clanTag;
    if (!tag) continue;

    const row = byTag.get(tag) ?? { totals: [], entered: 0 };
    row.entered += 1;

    const average = averageFor(contest, entrant);
    if (average !== null) row.totals.push(average);

    byTag.set(tag, row);
  }

  const rows: ClanStanding[] = [...byTag.entries()].map(([tag, row]) => ({
    tag,
    average: row.totals.length
      ? Math.round(row.totals.reduce((a, b) => a + b, 0) / row.totals.length)
      : null,
    finished: row.totals.length,
    entered: row.entered,
    place: 0,
  }));

  rows.sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.tag.localeCompare(b.tag));
  rows.forEach((row, index) => {
    row.place = row.average === null ? 0 : index + 1;
  });

  return rows;
}

/** Whether this pilot may take a seat, and why not when they may not. */
export function joinRefusal(
  contest: Contest,
  pilot: { id: string; clanTag: string | null },
): string | null {
  if (contest.entrants.some((e) => e.id === pilot.id)) return 'You are already in this one.';
  if (contest.status === 'settled') return 'This one is over.';
  if (seatsLeft(contest) <= 0) return 'It is full.';

  /*
   * A clan contest is between clans, so an unattached pilot has nothing to
   * enter on behalf of. Said as the reason rather than by hiding the contest,
   * because "join a clan first" is a thing they can act on and an absent card
   * is not.
   */
  if (contest.kind === 'clan' && !pilot.clanTag) {
    return 'Clan contests need a clan. Join one from your profile.';
  }

  if (contest.kind === 'clan' && contest.clanTag === pilot.clanTag) {
    return 'That is your own clan.';
  }

  return null;
}

/**
 * ## Why the gauntlet is not a shooting match
 *
 * It was asked for as last man standing: players shooting each other until one
 * survives. That is real-time PvP, and it needs an authoritative server running
 * the simulation, lag compensation and anti-cheat. This game is deterministic
 * and single player; everyone flies the same seed alone, and the only
 * multiplayer today is a replay of somebody's past run flying beside you.
 *
 * There is a second problem, and it is the one that decided it. These settle
 * for NIM. In a laggy real-time match the loser was beaten by their connection
 * rather than by the other player, and the fair bet guarantee this whole
 * project rests on stops being true the first time that happens.
 *
 * So the gauntlet keeps everything that made the idea good, which is the
 * pressure: one shared level, hideouts to break line of sight, refuel and
 * shield and heavy weapon pickups that last seconds, and a clock nobody
 * outlives. What it takes out is aiming at another human in real time. You are
 * racing their clock, and the level is identical for both of you, so the result
 * is verifiable in exactly the way a signed score already is.
 */
