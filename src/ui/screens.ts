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
import { STAGES, type Stage } from '../data/campaign';

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
  /** Current sound state, for the toggle's label. */
  soundOn: boolean;
  /** What is in hand, named on the button so the rack is never a mystery box. */
  weaponName: string;
  /** The pilot's clan, or null. Names the button either way. */
  clanTag: string | null;
  /** The stage about to be flown, and how far up the campaign they are. */
  stage: Stage;
  stagesCleared: number;
  onCampaign: () => void;
  onStart: () => void;
  onBoard: () => void;
  onLoadout: () => void;
  onClan: () => void;
  onToggleSound: () => void;
  onControls: () => void;
  /** Null on a phone, where fullscreen is refused or actively harmful. */
  onFullscreen: (() => void) | null;
  fullscreen: boolean;
  onReplayIntro: () => void;
  /** Absent when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;
}

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
        card,
        storyBlock(mission),
        // Moved over from the right column. The roster and the actions are
        // both long, so leaving the explanation with them left the left column
        // ending halfway up the page with nothing under it.
        el('p', { class: 'quiet', text: t('briefBody') }),
        hints,
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
        { class: 'col' },
        // The one thing the bar cannot carry: what this particular run is for.
        // No rank strip here any more, because the bar has the tier and the
        // lifetime total on every screen and two copies of it is noise.
        stageStrip(options),
        rosterBlock(mission),
        options.me,
        el(
          'div',
          { class: 'actions' },
          button(t('startRun'), options.onStart),
          options.onConnectX && !options.me
            ? button(t('connectX'), options.onConnectX, 'x')
            : null,
          button(`Loadout · ${options.weaponName}`, options.onLoadout, 'ghost'),
          button('The campaign', options.onCampaign, 'ghost'),
          button(
            options.clanTag ? `Clan · ${options.clanTag}` : 'Find a clan',
            options.onClan,
            'ghost',
          ),
          button('How to play', options.onControls, 'ghost'),
          button(t('viewBoard'), options.onBoard, 'ghost'),
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
          ),
        ),
      ),
    ),
  );
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
  onLoadout: () => void;
  onCampaign: () => void;
  onReplay: () => void;
  onChallenge: () => void;
  onShare: () => void;
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
    row(t('timeBonus'), timeBonus.toLocaleString()),
    row(t('bounty'), `×${state.mission.bountyMultiplier.toFixed(2)}`),
  );

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
        options.postError
          ? el('div', { class: 'notice notice--error', text: options.postError })
          : null,

        options.cardUrl
          ? el('img', {
              class: 'card-preview',
              src: options.cardUrl,
              alt: `Score card: ${state.score} points on ${state.mission.ticker}`,
            })
          : null,

        el(
          'div',
          { class: 'actions' },
          button(t('playAgain'), options.onReplay),
          button(t('challengeFriend'), options.onChallenge, 'ghost'),
          button(t('shareRun'), options.onShare, 'ghost'),
          el(
            'div',
            { class: 'minor' },
            button(t('viewBoard'), options.onBoard, 'quiet'),
            button('Campaign', options.onCampaign, 'quiet'),
            button('Loadout', options.onLoadout, 'quiet'),
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
  onTab: (tab: BoardTab) => void;
  onBack: () => void;
}

/** How many rows the board shows before it starts pinning instead. */
const BOARD_VISIBLE = 20;

export function renderBoard(root: HTMLElement, options: BoardOptions): void {
  const ranked = options.entries.map((entry, index) => ({ entry, place: index + 1 }));
  const visible = ranked.slice(0, BOARD_VISIBLE);

  /*
   * Pin the player's own row when it falls outside the visible top.
   *
   * A board that only shows the leaders answers "who is winning" and refuses
   * to answer "where am I", which is the question the person looking at it
   * actually has. Rank 340 is still worth seeing, and seeing it is what makes
   * the next run feel like it is for something.
   */
  const mine = options.meId ? ranked.find((r) => r.entry.id === options.meId) : undefined;
  const pinned = mine && mine.place > BOARD_VISIBLE ? mine : undefined;

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
      : el('div', { class: 'empty', text: t('boardEmpty') });

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
      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
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
