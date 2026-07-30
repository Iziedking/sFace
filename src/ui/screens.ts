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
import { progressOf, type Profile } from '../net/profile';
import { rankFor } from '../data/story';
import { deck, type DeckPanel } from './deck';
import { footer } from './footer';
import { walletCta } from './wallet-cta';
import { STAGES, type Stage } from '../data/campaign';
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
  /** Current sound state, for the toggle's label. */
  soundOn: boolean;
  /** What is in hand, named on the button so the rack is never a mystery box. */
  weaponName: string;
  /** The pilot's clan, or null. Names the button either way. */
  clanTag: string | null;
  /** The stage about to be flown, and how far up the campaign they are. */
  stage: Stage;
  stagesCleared: number;
  /** Today's three jobs inside this stage. */
  contracts: Contract[];
  onCampaign: () => void;
  onDispatch: () => void;
  onSignals: () => void;
  onStart: () => void;
  onBoard: () => void;
  onLoadout: () => void;
  onClan: () => void;
  onToggleSound: () => void;
  onAbout: () => void;
  onControls: () => void;
  /** Null on a phone, where fullscreen is refused or actively harmful. */
  onFullscreen: (() => void) | null;
  fullscreen: boolean;
  onReplayIntro: () => void;
  onSettings: () => void;
  /** Absent when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;
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
            tile('Loadout', options.weaponName, options.onLoadout),
            tile('Clan', options.clanTag ?? 'none', options.onClan),
            tile('Signals', 'who talks to you', options.onSignals),
          ),
          el(
            'div',
            { class: 'minor' },
            button(
              options.soundOn ? 'Sound on' : 'Sound off',
              options.onToggleSound,
              'quiet',
            ),
            options.onFullscreen
              ? button(
                  options.fullscreen ? 'Exit fullscreen' : 'Fullscreen',
                  options.onFullscreen,
                  'quiet',
                )
              : null,
            button('Replay intro', options.onReplayIntro, 'quiet'),
            button('Controls', options.onSettings, 'quiet'),
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
): HTMLElement {
  const node = el(
    'button',
    { class: live ? 'tile tile--live' : 'tile', type: 'button' },
    el('span', { class: 'tile__label', text: label }),
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
  /** True when this run was practice, so none of it was kept. */
  practice: boolean;
  /** Set when a money path refused for want of a wallet. Carries the door. */
  needsWallet: boolean;
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
          : el('div', {
              class: 'notice',
              text: `Stage ${state.stage.n} not cleared. ${state.stage.objective}`,
            }),

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
        { class: 'col' },
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
            ? 'Your best run of the day. Everyone flies the same seeded mission.'
            : 'Lifetime Face, every run counted. Rank is a record, never a power.',
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
        el('span', { text: isMe ? `${entry.name} (you)` : entry.name }),
      ),
      // The tier is only meaningful where we know a lifetime total, which is
      // every row on all-time and any daily row for a pilot we have seen.
      (entry.lifetimeFace ?? 0) > 0
        ? el('div', { class: 'board__tier', text: `${tier.tier} · ${tier.name}` })
        : null,
    ),

    el('span', {
      class: 'board__score',
      text: boardTab === 'allTime'
        ? `${entry.score.toLocaleString()}`
        : entry.score.toLocaleString(),
    }),
  );
}
