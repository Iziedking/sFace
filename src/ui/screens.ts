/**
 * The screens either side of a run.
 *
 * Onboarding under sixty seconds is an explicit judging criterion, so the
 * briefing is one screen with one primary button and no forms, no signup, and
 * no wallet prompt before the first run. The wallet is asked for at the moment
 * it buys the player something, which is when they want to stake or post a
 * score, and never as a toll gate on the way in.
 *
 * Every screen is a pure render into #ui with callbacks out. They hold no state
 * and they never touch the run.
 */

import { button, el, mount, row, stat } from './dom';
import { t, difficultyLabel } from '../data/copy';
import type { DailyMission } from '../game/mission';
import type { RunState } from '../game/state';
import { ATTACKER_SCORE, TIME_BONUS_PER_SECOND } from '../game/state';
import type { BoardEntry } from '../net/api';
import { accountUrl, explorerName } from '../core/explorer';
import { progressOf, type Profile } from '../net/profile';
import { rankFor } from '../data/story';
import { deck, type DeckPanel } from './deck';
import { footer } from './footer';
import { walletCta } from './wallet-cta';
import { STAGES, missedDemands, type Stage, type StageProgress } from '../data/campaign';
import type { Contract } from '../data/contracts';

export interface BriefOptions {
  mission: DailyMission;
  notice: string | null;
  /** Shown only before the very first run of a session. */
  showHints: boolean;
  /** The connected-account chip, when they have connected one. */
  me: HTMLElement | null;
  /** The pilot's record, or null before their first finished run. */
  profile: Profile | null;
  /** Shown when the host wallet is not on the main network. */
  testnet: boolean;
  /** The wallet's network, or null when there is no wallet. Three states. */
  network: string | null;
  /**
   * What the Profile tile says under its name.
   *
   * A rank when they have one, an invitation when they do not. Passed in
   * rather than derived here because the caller already knows whether a clan
   * request is waiting, and a tile that can nag is worth more than one that
   * only ever repeats the obvious.
   */
  profileValue: string;
  /** True when something in there wants attention, so the tile can say so. */
  profileAlert: boolean;
  /** How many contests are open, or an invitation when none are. */
  contestsValue: string;
  contestsAlert: boolean;
  onContests: () => void;
  onRoom: () => void;
  /** What the room tile says under its name, so it can carry a count. */
  roomValue: string;
  /** The stage about to be flown, and how far up the campaign they are. */
  stage: Stage;
  stagesCleared: number;
  /** Today's three jobs inside this stage. */
  contracts: Contract[];
  onCampaign: () => void;
  onDispatch: () => void;
  onStart: () => void;
  onBoard: () => void;
  onProfile: () => void;
  onAbout: () => void;
  onControls: () => void;
  onSettings: () => void;
  /** Absent when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;

  /**
   * Connecting the wallet, offered only inside Nimiq Pay and only until it is.
   *
   * The approval used to be asked for during boot, so the wallet appeared to
   * connect itself before the player had touched anything. It is a decision
   * now, and a decision needs somewhere to be made. Here, under signing in,
   * because the two are the same kind of act: this is who I am, this is what I
   * pay with.
   */
  onConnectWallet: (() => void) | null;
  /** The connected address, shortened, or null when there is not one yet. */
  walletAddress: string | null;
}

/**
 * The live deck, so it can be stopped before the next screen replaces it.
 * Module state because there is only ever one brief on screen.
 */
let activeDeck: { stop: () => void } | null = null;

export function renderBrief(root: HTMLElement, options: BriefOptions): void {
  const { mission } = options;

  const head = el(
    'div',
    { class: 'mission__head' },
    el('span', { class: 'mission__ticker', text: mission.ticker }),
    mission.live
      ? el('span', {
          class: 'mission__change',
          text: `${mission.changePct.toFixed(1)}%`,
        })
      : null,
  );

  const card = el(
    'div',
    { class: 'mission' },
    head,
    el('p', { text: mission.coinName }),
    el(
      'div',
      { class: 'mission__stats' },
      stat(t('fearIndex'), `${mission.fearGreed} · ${difficultyLabel(mission.fearGreed)}`),
      stat(t('difficulty'), `${mission.difficulty} of 5`),
    ),
  );

  const hints = options.showHints
    ? el(
        'ul',
        { class: 'hints' },
        el('li', { text: t('controlsMove') }),
        el('li', { text: t('controlsShoot') }),
        el('li', { text: t('controlsRescue') }),
      )
    : null;

  /*
   * Two wrappers, so a wide screen can lay this out in two columns.
   *
   * On phones the wrappers are `display: contents` and vanish entirely, which
   * leaves exactly the flat single column that was here before. Nothing about
   * the mobile layout changes, and there is no second markup path to keep in
   * step with this one.
   */
  /*
   * The brief turns itself over rather than scrolling.
   *
   * It grew: a mission card, then the story, then the stage, then three
   * contracts, then five people, and by the end it was a screen you had to
   * scroll to understand. That is the wrong shape for the first thing anybody
   * sees, and "can somebody go from zero to using this in under 60 seconds" is
   * a scored criterion in as many words.
   *
   * So the categories take turns in one fixed frame while the primary action
   * stays put underneath, never scrolled away. See ui/deck.ts, including why
   * an auto-advancing panel is only acceptable with four specific guarantees.
   */
  const panels: DeckPanel[] = [
    { label: "TODAY'S WRECK", body: el('div', { class: 'panel' }, card, hints) },
  ];

  const story = storyBlock(mission);
  if (story) panels.push({ label: 'ON X', body: el('div', { class: 'panel' }, story) });

  panels.push({
    label: 'YOUR STAGE',
    body: el('div', { class: 'panel' }, stageStrip(options)),
  });

  const contracts = contractBlock(options.contracts);
  if (contracts) panels.push({ label: 'CONTRACTS', body: el('div', { class: 'panel' }, contracts) });

  const roster = rosterBlock(mission);
  if (roster) panels.push({ label: 'IN THE WRECK', body: el('div', { class: 'panel' }, roster) });

  // Torn down on the next mount. Without this the timer outlives the DOM it
  // was written for and keeps firing against detached nodes.
  activeDeck?.stop();
  const built = deck({ panels });
  activeDeck = built;

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--split' },
      el(
        'div',
        { class: 'col' },
        el('p', { class: 'eyebrow', text: t('missionToday') }),
        el('h1', { text: t('tagline') }),
        built.root,
        // A stake reading "5 NIM" means something different on testnet, and
        // the honest fix is to say which network it is rather than hide it.
        options.testnet
          ? el('div', {
              class: 'notice',
              text: 'Testnet. Stakes settle in test NIM, so anyone can play without spending anything.',
            })
          : null,
        options.notice ? el('div', { class: 'notice', text: options.notice }) : null,
      ),
      el(
        'div',
        { class: 'col col--top' },
        options.me,
        el(
          'div',
          { class: 'actions' },
          button(t('startRun'), options.onStart),
          options.onConnectX && !options.me
            ? button(t('connectX'), options.onConnectX, 'x')
            : null,
          /*
           * Under the X button, and only inside the wallet.
           *
           * In a browser there is no wallet to connect and the button would be
           * a promise nothing can keep, so it is simply absent. Once connected
           * it becomes the address rather than disappearing, because a player
           * who just approved something wants to see that it took.
           */
          options.walletAddress
            ? el(
                'p',
                { class: 'brief__wallet' },
                el('span', { class: 'brief__wallettag', text: 'WALLET' }),
                el('span', { class: 'brief__walletid', text: options.walletAddress }),
              )
            : options.onConnectWallet
              ? button('Connect wallet', options.onConnectWallet, 'ghost')
              : null,
          /*
           * Everything else is a small tile rather than a full-width block.
           *
           * Eight stacked blocks all the size of "Start the run" said that
           * eight things mattered equally, which is both untrue and the reason
           * the screen needed scrolling. One primary action, then a grid.
           */
          el(
            'div',
            { class: 'tiles' },
            tile('Campaign', `${options.stagesCleared}/${STAGES.length}`, options.onCampaign),
            tile(
              'Dispatch',
              mission.story?.live ? 'live' : 'cached',
              options.onDispatch,
              mission.story?.live === true,
            ),
            // Named for what it is. "Board" was a tile nobody read as the
            // leaderboard, so the leaderboard was effectively missing.
            tile('Leaderboard', 'today and all time', options.onBoard),
            /*
             * Contests, beside the leaderboard rather than inside the profile.
             *
             * A board is what happened and a contest is what you can enter, so
             * they are the same kind of destination: today's game, out there,
             * with other people in it. The profile is for what is yours.
             */
            tile('Contests', options.contestsValue, options.onContests, options.contestsAlert),
            /*
             * Profile and Settings, and nothing else.
             *
             * Loadout, Clan and Signals moved into Profile and the four quiet
             * toggles moved into Settings. They were all defensible on their
             * own and together they made a home page with fourteen controls on
             * it, which reads as fourteen equally important things and so as
             * none. What is left is the three places you go for today's game,
             * then you and your settings.
             */
            tile(
              'Profile',
              options.profileValue,
              options.onProfile,
              options.profileAlert,
            ),
            tile('Settings', 'sound, controls, network', options.onSettings),
            /*
             * The room, last.
             *
             * Everything above it is today's game or your own account. This is
             * the only tile that leads to other people, which is why it carries
             * a mark: a leaderboard full of strangers you cannot reach is
             * exactly the problem it exists to solve.
             */
            tile('Room', options.roomValue, options.onRoom, false, 'room'),
            /*
             * How to play, beside the room rather than only in the footer.
             *
             * It was a footer link, which is where a site puts the things it
             * does not expect anybody to need, and this is the one page that
             * explains that the ground is a real chart. A first-time player
             * arriving here has no reason to look at the bottom of the page.
             *
             * It also fixes the row above it. Room was the last tile in an
             * odd-numbered grid, so it stretched the full width and read as a
             * section header rather than as one destination among several.
             */
            tile('How to play', 'the whole game in a minute', options.onControls),
          ),
        ),
      ),

      footer({
        onAbout: options.onAbout,
        onControls: options.onControls,
        onDispatch: options.onDispatch,
        onBoard: options.onBoard,
        onCampaign: options.onCampaign,
        network: options.network,
        testnet: options.testnet,
      }),
    ),
  );
}

/** One small square of the secondary grid: what it is, and its current state. */
function tile(
  label: string,
  value: string,
  onClick: () => void,
  live = false,
  icon?: string,
): HTMLElement {
  const node = el(
    'button',
    { class: live ? 'tile tile--live' : 'tile', type: 'button' },
    el(
      'span',
      { class: 'tile__label' },
      /*
       * A mark rather than a picture.
       *
       * Drawn in CSS so it inherits the ink, never arrives late, and cannot be
       * a missing image on a slow connection. Only the room carries one, which
       * is what makes it read as the different kind of place it is: everything
       * else on this page is today's game or your own account.
       */
      icon ? el('span', { class: `tile__icon tile__icon--${icon}`, 'aria-hidden': 'true' }) : null,
      el('span', { text: label }),
    ),
    el('span', { class: 'tile__value', text: value }),
  );
  node.addEventListener('click', onClick);
  return node;
}

/**
 * What this run is for. One line of stage, one line of objective.
 *
 * It sits above the roster because it is the only thing on the brief that
 * changes what the next ninety seconds ask of you. The roster is who is in
 * there; this is what clearing it means.
 */
function stageStrip(options: BriefOptions): HTMLElement {
  const { stage } = options;
  return el(
    'div',
    { class: 'onstage' },
    el('span', { class: 'onstage__n', text: String(stage.n) }),
    el(
      'div',
      { class: 'onstage__body' },
      el('div', { class: 'onstage__name', text: stage.name }),
      el('div', { class: 'onstage__objective', text: stage.objective }),
    ),
    el('span', {
      class: 'chrome__ticker',
      text: `${options.stagesCleared}/${STAGES.length}`,
    }),
  );
}

/**
 * Today's three jobs.
 *
 * On the brief rather than behind a tab, because they are the answer to "why
 * am I playing today rather than yesterday" and that question gets asked on
 * this screen or not at all.
 */
function contractBlock(contracts: readonly Contract[]): HTMLElement | null {
  if (contracts.length === 0) return null;

  return el(
    'div',
    {},
    el('p', { class: 'stat__label', text: "TODAY'S CONTRACTS" }),
    el(
      'div',
      { class: 'contracts' },
      ...contracts.map((contract) =>
        el(
          'div',
          { class: 'contract' },
          el(
            'div',
            { class: 'contract__body' },
            el('div', { class: 'contract__label', text: contract.label }),
            el('div', { class: 'contract__why', text: contract.because }),
          ),
          el('span', {
            class: 'contract__pay',
            text: `+${Math.round(contract.bonus * 100)}%`,
          }),
        ),
      ),
    ),
  );
}

/**
 * Today's crypto X story. The single most original thing on the screen, so it
 * gets its own block rather than a line of small print.
 *
 * When the read is live it says so, and when it is not the block is simply
 * absent. An empty state here would be worse than nothing: a headline with no
 * source behind it is exactly the fabricated-metric problem.
 */
function storyBlock(mission: DailyMission): HTMLElement | null {
  const story = mission.story;
  if (!story) return null;

  const chips = story.topics.map((topic) => el('span', { class: 'chip', text: topic }));

  return el(
    'div',
    { class: 'story' },
    el(
      'div',
      { class: 'story__topics' },
      el('span', {
        class: story.live ? 'chip chip--live' : 'chip',
        text: story.live ? 'LIVE ON X' : 'CACHED',
      }),
      el('span', { class: 'chip', text: sentimentLabel(story.sentiment) }),
    ),
    el('p', { class: 'story__headline', text: story.headline }),
    story.posts.length + story.threads.length > 0
      ? el('p', {
          class: 'story__more',
          text: `${story.posts.length} posts · ${story.threads.length} still running`,
        })
      : null,
    chips.length > 0 ? el('div', { class: 'story__topics' }, ...chips) : null,
  );
}

/** Who is in the wreck. Named, so the mission is about people. */
function rosterBlock(mission: DailyMission): HTMLElement | null {
  if (mission.roster.length === 0) return null;

  const rows = mission.roster.map((entry) =>
    el(
      'div',
      { class: 'roster__row' },
      // A generated mark, not a photograph. See the note in server/xsense.ts.
      el('div', { class: 'roster__avatar' }),
      el(
        'div',
        {},
        el('div', { class: 'roster__handle', text: rosterLabel(entry) }),
        el('div', { class: 'roster__line', text: entry.line }),
      ),
      el('div', { class: 'roster__bounty', text: String(entry.bounty) }),
    ),
  );

  return el(
    'div',
    {},
    el('p', { class: 'stat__label', text: 'IN THE WRECK' }),
    el('div', { class: 'roster' }, ...rows),
  );
}

/**
 * An @ prefix is a claim that an account exists. The fallback archetypes are
 * fictional and their ids are not valid handles, so they are shown by name
 * instead. Printing "@exchange-king" would be a small lie that costs more than
 * the consistency is worth.
 */
function rosterLabel(entry: { handle: string; displayName: string }): string {
  return /^[a-z0-9_]{1,15}$/.test(entry.handle) ? `@${entry.handle}` : entry.displayName;
}

/**
 * The rank strip. Tier, lifetime Face, and how far to the next one.
 *
 * This is the answer to "why am I doing this again tomorrow", so it sits above
 * the fold on the brief rather than buried on a profile screen nobody opens.
 * The bar is the point: a number alone does not read as progress, a bar that
 * is visibly two thirds full does.
 */
export function rankStrip(profile: Profile | null, options: { compact?: boolean } = {}): HTMLElement {
  const progress = progressOf(profile);
  const face = profile?.lifetimeFace ?? 0;

  const bar = el(
    'div',
    { class: 'rank__bar' },
    el('div', { class: 'rank__fill', style: `width:${Math.round(progress.fraction * 100)}%` }),
  );

  return el(
    'div',
    { class: options.compact ? 'rank rank--compact' : 'rank' },
    el(
      'div',
      { class: 'rank__head' },
      el('span', { class: 'rank__tier', text: `${progress.rank.tier}` }),
      el(
        'div',
        {},
        el('div', { class: 'rank__name', text: progress.rank.name }),
        el('div', {
          class: 'rank__meta',
          text: progress.next
            ? `${face.toLocaleString()} Face · ${progress.remaining.toLocaleString()} to ${progress.next.name}`
            : `${face.toLocaleString()} Face · top of the ladder`,
        }),
      ),
    ),
    bar,
  );
}

function sentimentLabel(sentiment: number): string {
  if (sentiment <= -60) return 'CAPITULATION';
  if (sentiment <= -20) return 'FEARFUL';
  if (sentiment < 20) return 'MIXED';
  if (sentiment < 60) return 'BULLISH';
  return 'EUPHORIC';
}

export interface ResultsOptions {
  state: RunState;
  /** Null while the card is still rendering. */
  cardUrl: string | null;
  /** Set when posting the score failed, so we can say so instead of lying. */
  postError: string | null;
  rank: number | null;
  /** The record after this run, for the strip. */
  profile: Profile | null;
  /** The new tier's name when this run crossed one, otherwise null. */
  rankedUp: string | null;
  /** The gun this run opened, if it opened one. */
  unlockedWeapon: string | null;
  /** Whether this run met its stage's objective. */
  stageCleared: boolean;
  /** The three that were on offer, and the ones this run actually met. */
  contracts: Contract[];
  contractsMet: Contract[];
  /** The stage this run just opened, when it opened one. */
  nextStage: Stage | null;
  onLoadout: () => void;
  onCampaign: () => void;
  onNextStage: () => void;
  /** Back to the brief. Every run has to end somewhere that is not itself. */
  onHome: () => void;
  onReplay: () => void;
  onChallenge: () => void;
  onShare: () => void;
  /**
   * Post this run into the room, or null when there is nothing to post.
   *
   * Separate from sharing, which sends a picture out to X. This one puts the
   * run in front of the people playing today, where somebody can tip it, and
   * it only exists when the run is the one on the board: the room resolves a
   * card from that row, so anything else would post a card that is not there.
   */
  onPostToRoom: (() => void) | null;
  /** True when this run was practice, so none of it was kept. */
  practice: boolean;
  /** Set when a money path refused for want of a wallet. Carries the door. */
  needsWallet: boolean;
  /**
   * Whether this run is on the board unsigned, with a wallet that could sign.
   *
   * The signature is offered, never sprung. It used to be asked for during the
   * post, which put a dialog in front of somebody reading their own score, and
   * asked whenever a wallet was present rather than connected, so it failed.
   */
  /** The finished run, read against the stage's demands. */
  progress: StageProgress;
  canSign: boolean;
  /**
   * Whether to offer writing this run onto the chain.
   *
   * Only on a run worth the fee. See anchorOffer for why it is not on every
   * results screen.
   */
  canAnchor: boolean;
  anchoring: boolean;
  anchorNotice: string | null;
  /** Set once this run is on the chain, so the offer becomes a receipt. */
  anchorHash: string | null;
  /**
   * True once a transaction has left the wallet, recorded or not.
   *
   * Separate from the hash because they can disagree: the send can succeed
   * while the service fails to write it down, and the player still needs
   * telling that their fee bought something.
   */
  anchorSent: boolean;
  /** True on a personal best or a first clear, which the panel says out loud. */
  anchorNotable: boolean;
  onAnchor: () => void;
  signing: boolean;
  /** What went wrong last time, or null. Never implies the score is at risk. */
  signNotice: string | null;
  onSign: () => void;
  /** Null when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;
  onBoard: () => void;
}

export function renderResults(root: HTMLElement, options: ResultsOptions): void {
  const { state } = options;
  const survived = state.phase === 'extracted';

  const timeBonus = survived ? Math.floor(state.timeLeft * TIME_BONUS_PER_SECOND) : 0;

  const breakdown = el(
    'div',
    { class: 'breakdown' },
    row(t('faces'), `${state.facesExtracted} of ${state.faces.length}`),
    row(
      'Caches recovered',
      state.relicTaken
        ? `${state.cachesTaken} · relic`
        : `${state.cachesTaken} of ${state.caches.length}`,
    ),
    row(t('attackers'), `${state.attackersCleared} × ${ATTACKER_SCORE}`),
    /*
     * Hull, because two stages are cleared or not on it.
     *
     * Reported from a playtest: somebody cleared twenty one attackers on a stage
     * that asks for twelve, was told they had not cleared it, and had no way to
     * find out why. The rule was working; the screen simply never said what the
     * number it was judged on had been.
     *
     * Shown on every stage rather than only the ones that test it, so it is not
     * a mysterious extra row that appears on the runs you failed.
     */
    row(
      'Hull left',
      `${Math.round(Math.max(0, state.player.health))}%`,
    ),
    row(t('timeBonus'), timeBonus.toLocaleString()),
    row(t('bounty'), `×${state.mission.bountyMultiplier.toFixed(2)}`),
    row('Stage', `×${state.stage.bounty}`),
    row(
      `Contracts (${options.contractsMet.length} of ${options.contracts.length})`,
      `×${state.contractBonus.toFixed(2)}`,
    ),
  );

  /*
   * Reads, on the stage that has them, with the misses shown.
   *
   * The misses are worth nothing and cost nothing here, which is the point:
   * the cost was paid during the run, in the street. Printing them anyway is
   * the only place a player finds out how good their read on the day actually
   * was, and that is the skill this stage is about.
   */
  if (state.nodes.length > 0) {
    breakdown.insertBefore(
      row(
        'Reads',
        state.nodesMissed > 0
          ? `${state.nodesCaptured} of ${state.nodes.length} · ${state.nodesMissed} missed`
          : `${state.nodesCaptured} of ${state.nodes.length}`,
      ),
      breakdown.children[2] ?? null,
    );
  }

  const lostCount = state.faces.filter((f) => f.state === 'lost').length;

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--split' },
      el(
        'div',
        { class: 'col' },
        // The gun is on the record. A challenge settles on a score, and the
        // person who lost one is entitled to know what shape beat them.
        el('p', {
          class: 'eyebrow',
          text: `STAGE ${state.stage.n} · ${state.mission.ticker} · ${state.weapon.name}`,
        }),
        el('h1', { text: survived ? t('runComplete') : t('runFailed') }),

        // If people were lost, say it plainly. Burying it would make the score
        // look better and teach the player nothing.
        lostCount > 0
          ? el('div', {
              class: 'notice notice--error',
              text: `${lostCount} still in the wreck.`,
            })
          : null,

        el(
          'div',
          { class: 'score' },
          el('span', { class: 'stat__label', text: t('score') }),
          el('span', { class: 'score__value', text: state.score.toLocaleString() }),
          options.rank !== null
            ? el('span', { class: 'score__rank', text: `Rank ${options.rank} today` })
            : null,
        ),

        breakdown,

        // Which of today's three landed, named. A multiplier with no reason
        // beside it is a number nobody learns anything from.
        options.contracts.length > 0
          ? el(
              'div',
              { class: 'contracts' },
              ...options.contracts.map((contract) =>
                el(
                  'div',
                  {
                    class: options.contractsMet.includes(contract)
                      ? 'contract contract--met'
                      : 'contract contract--missed',
                  },
                  el(
                    'div',
                    { class: 'contract__body' },
                    el('div', { class: 'contract__label', text: contract.label }),
                  ),
                  el('span', {
                    class: 'contract__pay',
                    text: options.contractsMet.includes(contract)
                      ? `+${Math.round(contract.bonus * 100)}%`
                      : 'missed',
                  }),
                ),
              ),
            )
          : null,

        // The rank moves on the results screen, which is the one moment the
        // player is already looking at what a run was worth.
        options.rankedUp
          ? el('div', { class: 'rankup' }, el('span', { text: 'RANK UP' }), el('strong', { text: options.rankedUp }))
          : null,
        // The campaign result, said before anything about score. Clearing a
        // stage is the thing the run was for; the number is how well.
        options.stageCleared
          ? el(
              'div',
              { class: 'rankup rankup--stage' },
              el('span', { text: 'FACE RESTORED' }),
              el('strong', { text: state.stage.restores }),
            )
          : missedPanel(state, options),

        // Clearing a stage used to say so and then leave you on a screen whose
        // only button was "Run it again", which is the one thing you have just
        // finished doing. The campaign is the reason to come back, so it has to
        // be the thing the screen points at.
        options.nextStage
          ? el(
              'div',
              { class: 'nextup' },
              el(
                'div',
                { class: 'nextup__body' },
                el('span', { class: 'stat__label', text: 'NEXT' }),
                el('div', {
                  class: 'nextup__name',
                  text: `Stage ${options.nextStage.n} · ${options.nextStage.name}`,
                }),
                el('div', { class: 'nextup__what', text: options.nextStage.objective }),
              ),
              button('Fly it', options.onNextStage, 'ghost'),
            )
          : null,

        options.unlockedWeapon
          ? el(
              'div',
              { class: 'rankup rankup--rack' },
              el('span', { text: 'NEW IN THE RACK' }),
              el('strong', { text: options.unlockedWeapon }),
            )
          : null,
        rankStrip(options.profile, { compact: true }),
      ),
      el(
        'div',
        /*
         * Top aligned, because on this screen the actions ARE the column.
         *
         * The split layout bottom-aligns a column's actions so they sit under
         * whatever is above them, which is right on the brief and wrong here:
         * this column is a score card and four buttons, and against a left
         * column running from the eyebrow down through eight breakdown rows to
         * the rank bar, `margin-top: auto` opened a hand's depth of nothing
         * between the card and Run it again. With no card to show it opened the
         * whole column. Reported twice as an empty box on the results.
         */
        { class: 'col col--top' },
        options.cardUrl
          ? el('img', {
              class: 'card-preview',
              src: options.cardUrl,
              alt: `Score card: ${state.score} points on ${state.mission.ticker}`,
            })
          : null,

        /*
         * The answer sits with the buttons, not at the top of the column.
         *
         * Challenge a friend in a plain browser sets a notice explaining that
         * staking needs Nimiq Pay, and that notice used to render above the
         * card, a full screen away from the button that caused it. The feature
         * worked and reported itself correctly, and it still read as a dead
         * button, because nothing changed anywhere the player was looking.
         */
        el(
          'div',
          { class: 'actions' },
          options.needsWallet
            ? walletCta({ reason: options.postError ?? 'This needs a Nimiq wallet.' })
            : options.postError
              ? el('div', { class: 'notice notice--error', text: options.postError })
              : null,

          signOffer(options),
      anchorOffer(options),

          /*
           * The practice bill, presented after a run they enjoyed rather than
           * before one they had not started. Nothing was taken from them: the
           * gate said this run would not be kept, and it was not. This is the
           * offer to make the next one count.
           */
          options.practice
            ? el(
                'div',
                { class: 'notice notice--practice' },
                el('p', {
                  class: 'notice__lead',
                  text: `${state.score.toLocaleString()} points, and none of it saved.`,
                }),
                el('p', {
                  text: 'That was practice. Sign in with X to play the daily mission, take a rank, earn Face and fly with a clan.',
                }),
                options.onConnectX
                  ? el('div', { class: 'actions' }, button('Sign in with X', options.onConnectX, 'x'))
                  : null,
              )
            : null,
          options.nextStage
            ? button(`Start Stage ${options.nextStage.n}`, options.onNextStage)
            : button(t('playAgain'), options.onReplay),
          options.nextStage
            ? button(t('playAgain'), options.onReplay, 'ghost')
            : null,
          button(t('challengeFriend'), options.onChallenge, 'ghost'),
          button(t('shareRun'), options.onShare, 'ghost'),
          options.onPostToRoom
            ? button('Post it in the room', options.onPostToRoom, 'ghost')
            : null,
          el(
            'div',
            { class: 'minor' },
            button('Home', options.onHome, 'quiet'),
            button(t('viewBoard'), options.onBoard, 'quiet'),
            button('Campaign', options.onCampaign, 'quiet'),
          ),
        ),
      ),
    ),
  );
}

export type BoardTab = 'daily' | 'allTime';

export interface BoardOptions {
  mission: DailyMission;
  tab: BoardTab;
  entries: BoardEntry[];
  /** Our own pilot id, so we can mark and pin our row. */
  meId: string | null;
  offline: boolean;
  loading: boolean;
  /** Zero-based page. */
  page: number;
  onPage: (page: number) => void;
  onTab: (tab: BoardTab) => void;
  onBack: () => void;
}

/**
 * Rows per page.
 *
 * Ten fits a phone without scrolling past the controls. The board used to show
 * twenty in one run and simply stop, which both buried the Back button and gave
 * anyone outside the top twenty no way to look further down.
 */
const PAGE_SIZE = 10;

export function renderBoard(root: HTMLElement, options: BoardOptions): void {
  const ranked = options.entries.map((entry, index) => ({ entry, place: index + 1 }));
  const pages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, options.page), pages - 1);
  const from = page * PAGE_SIZE;
  const visible = ranked.slice(from, from + PAGE_SIZE);

  /*
   * Pin the player's own row when it is not on the page being looked at.
   *
   * A board that only shows the leaders answers "who is winning" and refuses
   * to answer "where am I", which is the question the person looking at it
   * actually has. Rank 340 is still worth seeing, and seeing it is what makes
   * the next run feel like it is for something.
   */
  const mine = options.meId ? ranked.find((r) => r.entry.id === options.meId) : undefined;
  const onThisPage = mine && mine.place > from && mine.place <= from + PAGE_SIZE;
  const pinned = mine && !onThisPage ? mine : undefined;

  const body = options.loading
    ? el('p', { class: 'spinner', text: 'Reading the board' })
    : ranked.length > 0
      ? el(
          'div',
          { class: 'board' },
          ...visible.map((r) => boardRow(r.entry, r.place, options.meId, options.tab)),
          pinned
            ? el(
                'div',
                { class: 'board__gap' },
                el('span', { text: '···' }),
              )
            : null,
          pinned ? boardRow(pinned.entry, pinned.place, options.meId, options.tab) : null,
        )
      : el(
          'div',
          { class: 'empty' },
          el('p', { text: t('boardEmpty') }),
          el('p', {
            class: 'quiet',
            // Said plainly. A board with nobody on it is the truth on a new day,
            // and filling it with names that never played would be a lie that
            // costs more than the empty space.
            text:
              options.tab === 'daily'
                ? 'Nobody has posted a run on this level yet. First score sets the mark.'
                : 'No lifetime totals yet. Every finished run counts toward this.',
          }),
        );

  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', {
        class: 'eyebrow',
        text: options.tab === 'daily' ? `TODAY · ${options.mission.ticker}` : 'ALL TIME',
      }),
      el('h1', { text: options.tab === 'daily' ? 'Daily board' : 'The ladder' }),

      el(
        'div',
        { class: 'tabs' },
        tab('Today', options.tab === 'daily', () => options.onTab('daily')),
        tab('All time', options.tab === 'allTime', () => options.onTab('allTime')),
      ),

      el('p', {
        class: 'quiet',
        text:
          options.tab === 'daily'
            ? 'Your best run of the day. Everyone flies the same seeded mission. A row named Pilot is a real player who has not connected an X account.'
            : 'Lifetime Face, every run counted. Rank is a record, never a power. A row named Pilot is a real player who has not connected an X account.',
      }),

      options.offline
        ? el('div', { class: 'notice notice--error', text: t('boardOffline') })
        : null,

      body,

      !options.loading && pages > 1
        ? el(
            'div',
            { class: 'pager' },
            el('span', {
              class: 'pager__where',
              text: `${from + 1}–${Math.min(from + PAGE_SIZE, ranked.length)} of ${ranked.length}`,
            }),
            el(
              'div',
              { class: 'pager__steps' },
              button('Back', () => options.onPage(page - 1), 'quiet', { disabled: page === 0 }),
              button('More', () => options.onPage(page + 1), 'ghost', {
                disabled: page >= pages - 1,
              }),
            ),
          )
        : null,

      el(
        'div',
        { class: 'actions' },
        button('Back', options.onBack, 'ghost'),
      ),
    ),
  );
}

function tab(label: string, active: boolean, onClick: () => void): HTMLElement {
  const node = el('button', {
    class: active ? 'tab tab--on' : 'tab',
    type: 'button',
    text: label,
  });
  node.addEventListener('click', onClick);
  return node;
}

/** One row, shared by both tabs so they can never drift apart. */
function boardRow(
  entry: BoardEntry,
  place: number,
  meId: string | null,
  boardTab: BoardTab,
): HTMLElement {
  const isMe = entry.id === meId;
  const tier = rankFor(entry.lifetimeFace ?? 0).rank;

  return el(
    'div',
    { class: isMe ? 'board__row board__row--you' : 'board__row' },
    el('span', { class: 'board__rank', text: `${place}` }),

    entry.avatarUrl
      ? el('img', {
          class: 'board__avatar',
          src: entry.avatarUrl,
          alt: '',
          referrerpolicy: 'no-referrer',
          loading: 'lazy',
        })
      : el('div', { class: 'board__avatar' }),

    el(
      'div',
      { class: 'board__who' },
      el(
        'div',
        { class: 'board__name' },
        entry.clanTag ? el('span', { class: 'board__clan', text: entry.clanTag }) : null,
        nameNode(entry.name, isMe),
      ),
      // The tier is only meaningful where we know a lifetime total, which is
      // every row on all-time and any daily row for a pilot we have seen.
      (entry.lifetimeFace ?? 0) > 0
        ? el('div', { class: 'board__tier', text: `${tier.tier} · ${tier.name}` })
        : null,

      /*
       * The wallet, on the row, beside the name.
       *
       * It was only ever inside the folded panel below, which meant a board of
       * pilots showed no wallets at all until you opened one row at a time.
       * Asked for directly, and it is the right call: this is a Nimiq mini app
       * and the wallet is a large part of who a pilot is here.
       *
       * Masked to the ends rather than printed in full. The whole address is
       * four lines of base32 on a phone and would drown the name it belongs to;
       * the full thing, the key and the signature are all still one tap away.
       */
      entry.address ? el('div', { class: 'board__wallet', text: maskAddress(entry.address) }) : null,

      receipts(entry),
    ),

    el('span', {
      class: 'board__score',
      text: boardTab === 'allTime'
        ? `${entry.score.toLocaleString()}`
        : entry.score.toLocaleString(),
    }),
  );
}

/**
 * What the stage asked for and did not get.
 *
 * This used to print the stage's objective line, which is prose. Somebody
 * finished stage seven with three of five people out and was told to "learn
 * every project, answer every gate": the run was complete, nothing named what
 * they had missed, and the numbers they were judged on appeared nowhere. It
 * read as a bug, and the rule was working the whole time.
 *
 * Read straight off the same list the check uses, so the screen cannot say one
 * thing while the rule does another.
 */
function missedPanel(state: RunState, options: ResultsOptions): HTMLElement {
  const missed = missedDemands(state.stage, options.progress);

  return el(
    'div',
    { class: 'missed' },
    el('p', {
      class: 'missed__head',
      text: `Stage ${state.stage.n} not cleared`,
    }),
    el(
      'div',
      { class: 'missed__list' },
      ...missed.map((demand) =>
        el(
          'div',
          { class: 'missed__row' },
          el('span', { class: 'missed__what', text: demand.text }),
          // What they actually managed, so the gap is a number rather than a
          // thing to work out from the rows above.
          el('span', { class: 'missed__got', text: demand.got(options.progress) }),
        ),
      ),
    ),
    el('p', { class: 'missed__say', text: state.stage.objective }),
  );
}

/**
 * The name, linked to X when it is an X handle.
 *
 * A connected pilot's name is stored as `@handle`, which is already the whole
 * link. Sending somebody to the actual account is the same rule the Dispatch
 * follows everywhere else: if we print a handle, the person behind it has to be
 * one tap away, or we are just asserting that they exist.
 *
 * The pattern is X's own: letters, digits and underscore, at most fifteen. A
 * generated callsign like "Pilot 4F2A" fails it and stays plain text, which is
 * correct, because there is nothing to link to.
 */
function nameNode(name: string, isMe: boolean): HTMLElement {
  const handle = /^@([A-Za-z0-9_]{1,15})$/.exec(name.trim());
  const shown = isMe ? `${name} (you)` : name;

  if (!handle) return el('span', { text: shown });

  return el('a', {
    class: 'board__x',
    href: `https://x.com/${handle[1]}`,
    target: '_blank',
    rel: 'noopener noreferrer',
    title: `Open @${handle[1]} on X`,
    text: shown,
  });
}

/**
 * An address short enough to sit under a name.
 *
 * First block and last block, which is how every wallet in this space writes a
 * shortened address, and enough to recognise your own at a glance or to tell
 * two pilots apart. Anything that fails to look like an address is passed
 * through untouched rather than sliced into nonsense.
 */
export function maskAddress(address: string): string {
  const parts = address.trim().toUpperCase().split(/[\s-]+/).filter(Boolean);
  if (parts.length < 3) return address.trim().toUpperCase();
  return `${parts[0]} ${parts[1]} … ${parts[parts.length - 1]}`;
}

/**
 * What can be checked about this row, for the people who want to check it.
 *
 * Two different claims, deliberately not blurred into one badge:
 *
 *   the signature  proves the score. Ed25519 over the date, seed, stage and
 *                  number, and the address is derived from the key that made
 *                  it rather than taken from the client.
 *   the address    is a wallet, and the link opens it on chain. It does NOT
 *                  show the score, because a score is not a transaction, and
 *                  a pilot who has never staked has an account with nothing
 *                  on it.
 *
 * Collapsed by default. A board is for reading places, and folding the working
 * away costs one tap while putting sixty characters of base64 on every row
 * would cost the board.
 */
function receipts(entry: BoardEntry): HTMLElement | null {
  const url = accountUrl(entry.address);
  const proof = entry.proof ?? null;
  const anchor = entry.anchor ?? null;
  if (!url && !proof && !anchor) return null;

  return el(
    'details',
    { class: 'board__proof' },
    el('summary', {
      // The tick belongs to the signature, never to a bare wallet. Sharing one
      // mark between them is the exact conflation this panel exists to avoid.
      class: proof ? 'board__proofmark board__proofmark--signed' : 'board__proofmark',
      /*
       * Names what is inside, not just what happened.
       *
       * It said "signed", which is a fact about the row and gives no reason to
       * press it. Somebody looking for the wallet behind a pilot had no way to
       * know that this was where it lived, and reported the board as not
       * showing wallets at all. A proof always carries the address it was
       * derived from, so both words are always true together.
       */
      /*
       * On chain outranks signed, because it is the stronger claim.
       *
       * A signature proves who set a score and lives in this service. An anchor
       * is a transaction that exists whether or not this service does, so a row
       * carrying one says that first.
       */
      text: anchor ? 'on chain · wallet' : proof ? 'signed · wallet' : 'wallet',
    }),
    el(
      'div',
      { class: 'board__proofbody' },
      proof
        ? el('p', {
            class: 'board__prooflead',
            text: `Signed for stage ${proof.stage} on seed ${proof.seed.slice(0, 12)}. Anyone can check this against the public key.`,
          })
        : el('p', {
            class: 'board__prooflead',
            /*
             * The weaker claim, said as the weaker claim.
             *
             * A daily row is one run and one run can be signed. Lifetime Face
             * is the sum of dozens, so no signature covers the number beside
             * it and saying otherwise would be the one dishonest thing on a
             * board built to be checkable. What the address does prove is that
             * this account bound a wallet and signed a run with it at least
             * once, which is the difference between a name anybody can
             * regenerate and one with an address behind it.
             */
            text: 'This pilot has proved a wallet by signing a run. The total beside it is not itself signed.',
          }),
      anchor
        ? el('p', {
            class: 'board__prooflead',
            text: 'This run was written onto the chain. The transaction below carries its date, level, stage and score, and does not depend on sFace to stay there.',
          })
        : null,
      anchor ? field('TRANSACTION', anchor) : null,
      proof ? field('PUBLIC KEY', proof.publicKey) : null,
      proof ? field('SIGNATURE', proof.signature) : null,
      entry.address ? field('WALLET', entry.address) : null,
      url
        ? el(
            'a',
            {
              class: 'board__prooflink',
              href: url,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            `Open this wallet on ${explorerName()}`,
          )
        : null,
      // Said once, plainly, rather than left for somebody to discover by
      // opening an empty account and drawing the wrong conclusion.
      url
        ? el('p', {
            class: 'board__proofnote',
            text: 'That shows the wallet, not the run. Scores are signed, never sent, so sFace puts nothing on chain for them.',
          })
        : null,
    ),
  );
}

function field(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'board__field' },
    el('span', { class: 'board__fieldlabel', text: label }),
    el('span', { class: 'board__fieldvalue', text: value }),
  );
}

/**
 * The offer to bind this run to a wallet.
 *
 * ## What it does and does not say
 *
 * It does not say "store this on chain", because that is not what happens.
 * Signing produces an Ed25519 signature over the date, seed, stage and score.
 * Nothing is sent, no transaction exists, and a player who signed and then went
 * looking on an explorer would find nothing and reasonably conclude the app had
 * lied to them. The board draws the same line: the signature proves the run,
 * the wallet link opens an account.
 *
 * It also does not say the score is lost without this. It is not. The board has
 * always taken unsigned rows and marks them as such, and a plain browser has no
 * wallet at all. Threatening a loss that will not happen would buy one extra tap
 * at the cost of the one thing this product is actually selling, which is that
 * what it tells you is true.
 *
 * So it says what signing buys, in one line, and nothing else.
 *
 * ## Why there is no panel afterwards
 *
 * There was, briefly: a confirmation added because the offer used to vanish on
 * success, which read as nothing having happened. It fixed the silence and
 * replaced it with a wall of explanation on a screen somebody is trying to
 * leave. The wallet already confirms the signature at the moment it happens,
 * which is the right place for it, and the board row carries the mark from then
 * on. So the offer simply goes when it is done.
 */
/**
 * The offer to write this run onto the chain.
 *
 * ## How this differs from signing, which is the thing next to it
 *
 * Signing produces a signature that lives in this service's database. It proves
 * who set a score and it puts nothing anywhere: delete the service and the
 * proof goes with it. That is worth having and it is not what most people mean
 * when they say a score is on chain.
 *
 * Anchoring is an ordinary Nimiq transaction carrying the run in its data
 * field. It has a hash, it appears on a public explorer, and it survives this
 * app entirely. It also costs a network fee, which is the honest reason it is
 * not simply done for everybody.
 *
 * ## Why only on a run worth it
 *
 * Offered after a personal best or a first clear rather than on every screen.
 * A button asking for a fee after every run reads as a toll, and most runs are
 * not worth paying to remember. The rule is in main.ts, next to the record of
 * what the player has actually done.
 */
function anchorOffer(options: ResultsOptions): HTMLElement | null {
  if (options.anchorHash) {
    return el(
      'div',
      { class: 'notice notice--anchored' },
      el('p', { class: 'notice__lead', text: 'This run is on the chain.' }),
      el('p', { class: 'notice__hash', text: options.anchorHash }),
    );
  }

  /*
   * Sent, but not linked to the row. The transaction is real and the fee is
   * spent, so this says so and says not to pay for another.
   */
  if (options.anchorSent) {
    return el(
      'div',
      { class: 'notice notice--anchor' },
      el('p', { class: 'notice__lead', text: 'Sent from your wallet.' }),
      el('p', {
        text: 'It is on the chain. sFace could not link it here, so do not send it again.',
      }),
      options.anchorNotice
        ? el('p', { class: 'notice__warn', text: options.anchorNotice })
        : null,
    );
  }

  if (!options.canAnchor) return null;

  return el(
    'div',
    { class: 'notice notice--anchor' },
    el('p', {
      class: 'notice__lead',
      text: options.anchorNotable
        ? 'Your best yet. Write it on chain?'
        : 'Write this score on chain?',
    }),
    el('p', { text: 'Costs a small network fee. It becomes permanent and public.' }),
    options.anchorNotice
      ? el('p', { class: 'notice__warn', text: options.anchorNotice })
      : null,
    el(
      'div',
      { class: 'actions' },
      button(
        options.anchoring ? 'Waiting for the wallet...' : 'Write it on chain',
        options.onAnchor,
        'ghost',
        { disabled: options.anchoring },
      ),
    ),
  );
}

function signOffer(options: ResultsOptions): HTMLElement | null {
  if (!options.canSign) return null;

  return el(
    'div',
    { class: 'notice notice--sign' },
    el('p', { class: 'notice__lead', text: 'Prove this run is yours?' }),
    el('p', {
      text: 'Your wallet signs it and the board publishes the signature. Free, and nothing is sent.',
    }),
    options.signNotice ? el('p', { class: 'notice__warn', text: options.signNotice }) : null,
    el(
      'div',
      { class: 'actions' },
      button(
        options.signing ? 'Waiting for the wallet...' : 'Sign this run',
        options.onSign,
        'ghost',
        { disabled: options.signing },
      ),
    ),
  );
}
