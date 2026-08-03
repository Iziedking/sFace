/**
 * What a pilot has done, for as long as they keep the same identity.
 *
 * This is what turns a good run into progress. The daily board resets every
 * midnight, which is correct for a daily challenge and useless as a reason to
 * come back: nothing you did on Tuesday exists on Friday. A profile
 * accumulates, so a great run keeps counting.
 *
 * ## Every run counts, not the best one
 *
 * The leaderboard keeps a pilot's best run of the day, because a board is a
 * ranking. A profile adds every run, because it is a record of showing up.
 * Those are different questions and they want different answers, which is why
 * this is a separate store rather than a column on the board.
 *
 * The obvious objection is that it rewards grinding. It does, and that is
 * intended: rank is a record, never a power. A tier eight pilot flies the
 * identical mission to a tier one, and the daily board still ranks them purely
 * on skill.
 *
 * Lifetime Face does open weapons, which sounds like it contradicts the
 * paragraph above and does not. Every gun in src/data/weapons.ts is a sidegrade
 * with a stated cost, so a full rack is more ways to fly and never more damage.
 * The rule is written out at the top of that file, and if a future edit breaks
 * it the daily challenge stops being a fair bet.
 *
 * ## One person, one record per chain
 *
 * A player is one player. Connecting X gives them an identity that follows them
 * onto whichever chain they are flying, so their name, picture and clan are the
 * same in both places, and switching networks is a setting rather than a second
 * account.
 *
 * What does not follow them is the scoring. Testnet NIM comes out of a faucet
 * and a rehearsal never triggers a paid read, so a testnet run is flown on a
 * cached or practice mission with nothing at stake. Pooling those totals with
 * the real ones would put free Face in a real rank.
 *
 * There is a sharper reason than tidiness. `stagesCleared` feeds the assist
 * tier in src/game/assist.ts, so a shared campaign count would let a player
 * grind an unmetered testnet into a measurably easier mainnet run. That is the
 * purchasable advantage the whole project is built to refuse, arriving through
 * the back door in a different currency.
 *
 * So identity is one thing and progress is another. Everything that says who
 * you are lives on the account. Everything that ranks you lives in `chains`,
 * keyed by network. `Profile` is the flat view of one account on one chain,
 * which is what every caller already wanted, so nothing downstream had to
 * learn a new shape.
 *
 * ## What stops it being nonsense
 *
 * Nothing here is verified, and it is not presented as though it were. Runs
 * arrive through the same plausibility bounds the board uses: a score above
 * the game's maximum, a duration a run cannot have, or a high score against an
 * impossibly short run are all refused before they reach this file. Beyond
 * that it is a record of what a client claimed, and the README says so.
 */

/** Everything that ranks a pilot. Kept per chain. */
export interface Progress {
  lifetimeFace: number;
  runs: number;
  bestScore: number;
  /** People who reached extraction, across every run. */
  rescued: number;
  caches: number;
  relics: number;
  /** Runs that reached the pad rather than ending in the ground. */
  extractions: number;
  /**
   * Highest campaign stage cleared, 0 to 7.
   *
   * Kept here rather than on the daily board because it is the one number that
   * has to survive midnight. A campaign that reset every day would not be a
   * campaign.
   */
  stagesCleared: number;

  /**
   * Staked contests this pilot has lost and been billed for, and how many of
   * those they actually paid.
   *
   * ## Why this lives on the profile rather than being counted from contests
   *
   * Contests are pruned two days after the level they were pinned to, because
   * nobody can verify one against a mission the service no longer holds. A
   * settlement record counted from them would therefore reset every couple of
   * days, which is the opposite of a record: the whole value of it is that it
   * outlives the thing it is about.
   *
   * ## Why it exists at all
   *
   * There is no escrow, so nothing makes a loser pay. What the app can do is
   * make not paying legible. Somebody deciding whether to stake against a
   * stranger has one question, and this is the answer to it.
   *
   * Per chain, like everything else here. A testnet stake is faucet NIM and
   * settling one says nothing about whether you would settle a real debt.
   */
  stakesOwed: number;
  stakesSettled: number;
}

/**
 * Everything that identifies a pilot, plus their progress on each chain.
 *
 * Internal. Callers get a `Profile`, which is this flattened onto one network.
 */
interface Account {
  id: string;
  name: string;
  /** Only set when they connected an account and shared a picture. */
  avatarUrl: string | null;
  /** Four characters, uppercase. Null until they join one. */
  clanTag: string | null;
  /**
   * The wallet that has signed for this pilot, once one has.
   *
   * ## Why it lives on the account rather than per chain
   *
   * Identity is one thing here and scoring is another. A wallet is who you are,
   * so it follows you across the switch the same way your name and clan do.
   *
   * ## Why the board needs it
   *
   * The daily board carries a signature per row, because a daily row is one run
   * and one run can be signed. Lifetime Face is the sum of dozens, so there is
   * no single signature over it and the all-time board had no verification of
   * any kind: every row looked the same whether a wallet stood behind it or
   * nobody did.
   *
   * This is the weaker claim that is still worth making. It does not attest to
   * the total, and nothing here says it does. It says this account has bound a
   * wallet and proved it at least once, which is the difference between a name
   * anybody can regenerate and one with an address behind it.
   */
  address: string | null;
  firstSeen: number;
  lastSeen: number;
  /** Keyed by network id. Absent means they have never flown there. */
  chains: Record<string, Progress>;
}

/** One account, as seen from one chain. */
export interface Profile extends Progress {
  id: string;
  name: string;
  /** Which chain this view is of. */
  network: string;
  avatarUrl: string | null;
  clanTag: string | null;
  /** The wallet that has signed for this pilot, or null. */
  address: string | null;
  firstSeen: number;
  lastSeen: number;
}

export interface RunRecord {
  id: string;
  name: string;
  /** Which chain the run was flown on. Decides which total it lands in. */
  network?: string;
  avatarUrl: string | null;
  score: number;
  rescued: number;
  caches: number;
  relics: number;
  extracted: boolean;
  /** The stage this run was flown on, and whether it met the objective. */
  stage?: number;
  stageCleared?: boolean;
}

const accounts = new Map<string, Account>();

const DEFAULT_NETWORK = 'main';

function emptyProgress(): Progress {
  return {
    lifetimeFace: 0,
    runs: 0,
    bestScore: 0,
    rescued: 0,
    caches: 0,
    relics: 0,
    extractions: 0,
    stagesCleared: 0,
    stakesOwed: 0,
    stakesSettled: 0,
  };
}

/**
 * Take only the eight numbers, whatever else came with them.
 *
 * A flat pre-split record carries its identity fields in the same object as its
 * totals, so spreading it wholesale puts a copy of the name, id and clan inside
 * the progress bucket. `view` spreads the bucket last, which means those stale
 * copies win over the account's real ones: rename a pilot and the old name
 * comes back until they next fly that chain.
 *
 * Nothing about a chain is identity, so nothing about identity belongs in here.
 */
function pickProgress(raw: unknown): Progress {
  const from = (raw ?? {}) as Partial<Progress>;
  const out = emptyProgress();
  for (const key of Object.keys(out) as Array<keyof Progress>) {
    const value = from[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function newAccount(id: string, name: string): Account {
  const now = Date.now();
  return {
    id,
    name,
    avatarUrl: null,
    clanTag: null,
    address: null,
    firstSeen: now,
    lastSeen: now,
    chains: {},
  };
}

/** Flatten an account onto one chain. A chain never flown reads as zeroes. */
function view(account: Account, network: string): Profile {
  return {
    id: account.id,
    name: account.name,
    network,
    avatarUrl: account.avatarUrl,
    clanTag: account.clanTag,
    address: account.address,
    firstSeen: account.firstSeen,
    lastSeen: account.lastSeen,
    ...(account.chains[network] ?? emptyProgress()),
  };
}

/** A profile that exists only in memory, for a pilot we have never seen. */
export function blank(id: string, name: string, network = DEFAULT_NETWORK): Profile {
  return view(newAccount(id, name), network);
}

export function get(id: string, network = DEFAULT_NETWORK): Profile | null {
  const account = accounts.get(id);
  return account ? view(account, network) : null;
}

/** Fold a finished run into a profile, creating it on first sight. */
export function record(run: RunRecord): Profile {
  const network = run.network ?? DEFAULT_NETWORK;
  const account = accounts.get(run.id) ?? newAccount(run.id, run.name);
  const before = account.chains[network] ?? emptyProgress();

  account.chains[network] = {
    lifetimeFace: before.lifetimeFace + Math.max(0, run.score),
    runs: before.runs + 1,
    bestScore: Math.max(before.bestScore, run.score),
    rescued: before.rescued + Math.max(0, run.rescued),
    caches: before.caches + Math.max(0, run.caches),
    relics: before.relics + Math.max(0, run.relics),
    extractions: before.extractions + (run.extracted ? 1 : 0),
    // Only ever forward, and only one at a time. A client claiming it cleared
    // Stage 7 having never cleared Stage 1 gets the next stage in order, which
    // is the same guard the unlock rule uses on the way in.
    stagesCleared:
      run.stageCleared && (run.stage ?? 0) === before.stagesCleared + 1
        ? before.stagesCleared + 1
        : before.stagesCleared,
    // Untouched by flying. Only a contest settling moves these.
    stakesOwed: before.stakesOwed,
    stakesSettled: before.stakesSettled,
  };

  // The display name follows the latest run, so connecting an X account
  // mid-session updates a pilot everywhere rather than leaving a stale
  // generated callsign on the board.
  account.name = run.name;
  account.avatarUrl = run.avatarUrl ?? account.avatarUrl;
  account.lastSeen = Date.now();

  accounts.set(run.id, account);
  persist();
  return view(account, network);
}

/**
 * Fold one profile into another and retire the first.
 *
 * ## Why this exists
 *
 * A record used to be keyed on the device it was earned on, so the same person
 * on a phone and a laptop was two players with two piles of Face. Identity is
 * the X account, and progress should follow it, so a client that signs in tells
 * us which device record belongs to which account and this joins them.
 *
 * ## Merge, never overwrite
 *
 * The obvious implementation replaces one with the other, and it is wrong in a
 * case that will absolutely happen: somebody plays anonymously on their phone,
 * plays anonymously on their laptop, then signs in on both. A replace means
 * whichever they signed into second silently destroys the first. So totals are
 * summed and bests are taken, which is correct however many devices arrive and
 * in whatever order.
 *
 * Chains fold independently, so a device that only ever flew testnet adds to
 * the testnet total and leaves the real one alone. Merging joins two devices
 * belonging to one person; it is not a way to move Face from the free chain
 * onto the paid one.
 *
 * ## Idempotent
 *
 * The source is deleted once folded in, so a client that retries, or signs in
 * twice, cannot count the same runs again. That matters because sign-in is a
 * page redirect and redirects get repeated.
 */
export function merge(
  fromId: string,
  intoId: string,
  network = DEFAULT_NETWORK,
): Profile | null {
  if (fromId === intoId) return get(intoId, network);

  const from = accounts.get(fromId);
  if (!from) {
    // Nothing to fold in. Not an error: the usual case is somebody signing in
    // on a device that has never finished a run.
    return get(intoId, network);
  }

  const into = accounts.get(intoId);

  if (!into) {
    /*
     * The account has no record yet, so the device's becomes it.
     *
     * Re-keyed rather than copied field by field, which keeps firstSeen honest:
     * the account has been playing since that device started, not since the
     * moment it signed in.
     */
    const moved: Account = { ...from, id: intoId };
    accounts.set(intoId, moved);
    accounts.delete(fromId);
    persist();
    return view(moved, network);
  }

  for (const [network, add] of Object.entries(from.chains)) {
    const have = into.chains[network] ?? emptyProgress();
    into.chains[network] = {
      // Totals add. Two devices are two sets of runs by one person.
      lifetimeFace: have.lifetimeFace + add.lifetimeFace,
      runs: have.runs + add.runs,
      rescued: have.rescued + add.rescued,
      caches: have.caches + add.caches,
      relics: have.relics + add.relics,
      extractions: have.extractions + add.extractions,
      // Bests take the better. A personal best is a personal best wherever it
      // happened.
      bestScore: Math.max(have.bestScore, add.bestScore),
      stagesCleared: Math.max(have.stagesCleared, add.stagesCleared),
      // Debts add, like any other total. Two devices are one person's history.
      stakesOwed: have.stakesOwed + add.stakesOwed,
      stakesSettled: have.stakesSettled + add.stakesSettled,
    };
  }

  // The account keeps its own name and picture, which came from X and are
  // more authoritative than a generated callsign.
  into.avatarUrl = into.avatarUrl ?? from.avatarUrl;
  // A wallet already proved on the account wins; otherwise inherit the device's,
  // so somebody who signed before connecting X does not lose the binding.
  into.address = into.address ?? from.address;
  // A clan already joined on the account wins; otherwise inherit the device's,
  // so somebody who joined one before signing in does not lose it.
  into.clanTag = into.clanTag ?? from.clanTag;
  into.firstSeen = Math.min(into.firstSeen, from.firstSeen);
  into.lastSeen = Math.max(into.lastSeen, from.lastSeen);

  accounts.set(intoId, into);
  accounts.delete(fromId);
  persist();
  return view(into, network);
}

/**
 * Note that this pilot has been billed for a staked contest they lost.
 *
 * Called once, when the contest settles, for each entrant who owes. Creating
 * the profile if it does not exist: somebody can enter a contest before they
 * have finished a run of their own, and a debt that failed to record because
 * there was no row for it is exactly the one worth recording.
 */
export function recordDebt(id: string, name: string, network = DEFAULT_NETWORK): void {
  const account = accounts.get(id) ?? newAccount(id, name);
  const before = account.chains[network] ?? emptyProgress();
  account.chains[network] = { ...before, stakesOwed: before.stakesOwed + 1 };
  accounts.set(id, account);
  persist();
}

/**
 * Note that they paid one.
 *
 * Never more than they were billed for. The count is reported by the payer, so
 * without the clamp a client could report the same settlement repeatedly and
 * end up reading better than perfect, which is the one direction this number
 * must not be able to move.
 */
export function recordSettlement(id: string, network = DEFAULT_NETWORK): void {
  const account = accounts.get(id);
  if (!account) return;

  const before = account.chains[network] ?? emptyProgress();
  account.chains[network] = {
    ...before,
    stakesSettled: Math.min(before.stakesOwed, before.stakesSettled + 1),
  };
  persist();
}

/**
 * Record the wallet that just proved a score for this pilot.
 *
 * Only ever called with an address the service derived from a signature it
 * verified, never with one a client sent. That is the whole reason the mark on
 * the board means anything: an address in a request is a claim, and an address
 * derived from a working signature is its author.
 *
 * Last one wins. Somebody who changes wallets is still one person, and the
 * useful statement is that this account has a wallet behind it now.
 */
export function bindAddress(id: string, address: string): void {
  const account = accounts.get(id);
  if (!account || account.address === address) return;

  account.address = address;
  persist();
}

/** One spelling for one wallet, so two formats never count as two people. */
function key(address: string): string {
  return address.replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * How many distinct wallets this app has actually seen.
 *
 * ## Why only proved wallets are counted
 *
 * A wallet counts here once it has signed something, because a signature is the
 * only claim about an address that cannot simply be asserted. The app also
 * learns an address the moment somebody connects, and counting those would give
 * a larger, friendlier number that anyone could inflate by posting whatever
 * address they liked. A figure you can pad is not a measurement, and this one
 * exists to be quoted.
 *
 * Counted per chain, because testnet wallets are not users. Deduplicated by
 * address rather than by pilot: one person with two wallets is two wallets, and
 * one wallet used from two devices is one.
 */
export function walletCount(network = DEFAULT_NETWORK): number {
  const seen = new Set<string>();

  for (const account of accounts.values()) {
    if (!account.address) continue;
    // Only pilots who have flown on this chain. An account that has never
    // scored here has not interacted with this chain's app.
    const progress = account.chains[network];
    if (!progress || progress.runs <= 0) continue;
    seen.add(key(account.address));
  }

  return seen.size;
}

/** Everything worth quoting about usage on one chain. */
export function usage(network = DEFAULT_NETWORK): {
  wallets: number;
  pilots: number;
  runs: number;
} {
  let pilots = 0;
  let runs = 0;

  for (const account of accounts.values()) {
    const progress = account.chains[network];
    if (!progress || progress.runs <= 0) continue;
    pilots += 1;
    runs += progress.runs;
  }

  return { wallets: walletCount(network), pilots, runs };
}

/**
 * Set or clear a pilot's clan. Used by the clan endpoints.
 *
 * A clan is identity, not score, so this is not per chain: you are in the same
 * clan whichever network you are flying. What each chain contributes to that
 * clan's total is a separate question, answered in server/clans.ts.
 */
export function setClan(
  id: string,
  clanTag: string | null,
  network = DEFAULT_NETWORK,
): Profile | null {
  const account = accounts.get(id);
  if (!account) return null;

  account.clanTag = clanTag;
  persist();
  return view(account, network);
}

/** Ensure a profile exists so a pilot can join a clan before their first run. */
export function ensure(id: string, name: string, network = DEFAULT_NETWORK): Profile {
  const existing = accounts.get(id);
  if (existing) return view(existing, network);

  const created = newAccount(id, name);
  accounts.set(created.id, created);
  persist();
  return view(created, network);
}

/** Every profile as seen from one chain. Used to fold the clan table. */
export function all(network = DEFAULT_NETWORK): Profile[] {
  return [...accounts.values()].map((account) => view(account, network));
}

/** All-time board for one chain, ranked on lifetime Face. */
export function allTime(limit: number, network = DEFAULT_NETWORK): Profile[] {
  return all(network)
    .filter((p) => p.lifetimeFace > 0)
    .sort((a, b) => b.lifetimeFace - a.lifetimeFace || a.firstSeen - b.firstSeen)
    .slice(0, Math.max(0, limit));
}

/**
 * Where a pilot sits all-time on one chain, 1-based. Zero when they have never
 * scored there.
 */
export function rankOf(id: string, network = DEFAULT_NETWORK): number {
  const profile = get(id, network);
  if (!profile || profile.lifetimeFace <= 0) return 0;

  let above = 0;
  for (const other of all(network)) {
    if (other.id === id) continue;
    if (
      other.lifetimeFace > profile.lifetimeFace ||
      (other.lifetimeFace === profile.lifetimeFace && other.firstSeen < profile.firstSeen)
    ) {
      above++;
    }
  }
  return above + 1;
}

/**
 * Everyone in a clan, as seen from one chain.
 *
 * The roster is the same on both networks, because a clan is a group of people.
 * The Face beside each name is not, so this returns the view for the chain
 * being asked about and a member who has never flown it reads as zero.
 */
export function membersOf(clanTag: string, network = DEFAULT_NETWORK): Profile[] {
  return all(network).filter((p) => p.clanTag === clanTag);
}

export function count(): number {
  return accounts.size;
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...accounts.values()];
}

/**
 * How many records the last restore had to migrate.
 *
 * Read at boot to decide whether the file on disk is still the old shape. It is
 * a count rather than a boolean so the log line can say what actually moved: a
 * migration that silently touches every profile is worth one honest sentence in
 * the output, and "migrated 0" is the line that proves it is finally done.
 */
let migrated = 0;

export function legacyCount(): number {
  return migrated;
}

export function restore(raw: unknown): void {
  migrated = 0;
  if (!Array.isArray(raw)) return;

  // Replace rather than merge. A snapshot is a statement about the whole store,
  // not an addition to it, so restoring twice has to leave the same result as
  // restoring once. At boot the map is empty and this clear is a no-op.
  accounts.clear();

  for (const item of raw as Array<Partial<Account> & Partial<Profile>>) {
    if (!item || typeof item.id !== 'string') continue;

    const account = newAccount(item.id, item.name ?? 'Pilot');
    account.avatarUrl = item.avatarUrl ?? null;
    account.clanTag = item.clanTag ?? null;
    account.address = typeof item.address === 'string' ? item.address : null;
    if (typeof item.firstSeen === 'number') account.firstSeen = item.firstSeen;
    if (typeof item.lastSeen === 'number') account.lastSeen = item.lastSeen;

    if (item.chains && typeof item.chains === 'object') {
      for (const [network, progress] of Object.entries(item.chains)) {
        account.chains[network] = pickProgress(progress);
      }
    } else {
      /*
       * A snapshot written before progress was split by chain.
       *
       * Those records carry their totals flat, with an optional network that
       * only ever said 'test' during the short window the two were separate
       * identities. Anything without one predates that entirely and was
       * mainnet, which is the safe reading: it keeps real Face on the real
       * board rather than quietly demoting it to a rehearsal.
       */
      const network = typeof item.network === 'string' ? item.network : DEFAULT_NETWORK;
      account.chains[network] = pickProgress(item);
      migrated++;
    }

    accounts.set(account.id, account);
  }
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}
