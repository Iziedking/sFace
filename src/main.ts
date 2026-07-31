/**
 * Boot, screen routing, and the one loop that drives everything.
 *
 * Design decisions worth knowing before you edit this file:
 *
 * The loop runs from the moment the mission loads and never stops, including
 * while a menu is up. The world keeps rendering behind every screen, so the
 * player looks at the actual chart they are about to fly rather than a static
 * splash. Stepping is gated on the screen being 'run', so nothing simulates
 * while a menu is open.
 *
 * Nothing blocks on the wallet. The mission loads, the brief appears, and the
 * player can be flying while the provider is still being probed in the
 * background. Onboarding under sixty seconds is a judging criterion and a
 * wallet handshake in the critical path is the usual way to lose it.
 */

import { GameLoop } from './core/loop';
import { Input } from './core/input';
import { audio, voiceForEvent } from './core/audio';
import { music } from './core/music';
import { setLanguage, t } from './data/copy';
import { utcDate, type DailyMission } from './game/mission';
import { loadMission } from './net/mission';
import { RunState, PLAYER_MAX_HEALTH } from './game/state';
import { step } from './game/update';
import type { PlayerCommand } from './game/player';
import { GhostRecorder, decodeTrace, type GhostFrame } from './game/ghost';
import { Squad } from './game/squad';
import { LiveLink } from './net/live';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { Hud } from './render/hud';
import { Effects } from './render/effects';
import { renderBoard, renderBrief, renderResults, type BoardTab } from './ui/screens';
import { initialSteps, renderLoading, type LoadStep } from './ui/loading';
import { renderChallenge } from './ui/challenge';
import { introSeen, renderIntro } from './ui/intro';
import { takeInAppReload } from './core/network';
import { accountKey } from './net/identity';
import { mergeProfile } from './net/profile';
import { renderControls } from './ui/controls';
import { renderGate } from './ui/gate';
import { renderPause, renderRunOverlay } from './ui/pause';
import { showBriefCard } from './ui/brief';
import { earnedAssist } from './game/assist';
import { renderLoadout } from './ui/loadout';
import { renderClan } from './ui/clan';
import { renderCampaign } from './ui/campaign';
import { renderAbout } from './ui/about';
import { renderHandoff } from './ui/handoff';
import { renderEnding } from './ui/ending';
import { renderDispatch } from './ui/dispatch';
import { renderSignals } from './ui/signals';
import { SPLASH_FULL_MS, pause as splashPause, renderSplash } from './ui/splash';
import { hideChrome, renderChrome } from './ui/chrome';
import { chooseWeapon, resolveWeapon } from './core/loadout';
import { narrator } from './core/voice';
import {
  fullscreenAvailable,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './core/fullscreen';
import { cardDataFrom, cardFile, drawScoreCard, shareLink, shareRun } from './ui/share';
import {
  acceptChallenge,
  apiConfigured,
  createChallenge,
  fetchAllTime,
  fetchBoard,
  fetchChallenge,
  decideClanRequest,
  fetchClan,
  fetchClans,
  fetchGhosts,
  fetchSignals,
  joinClan,
  unlockSignals,
  postGhost,
  postScore,
  reportSettlement,
  type BoardEntry,
  type Challenge,
  type ClanDetail,
  type ClanRow,
  type Signals,
} from './net/api';
import { pilotId, pilotName, upgradeTo } from './net/identity';
import {
  cacheProfile,
  fetchProfile,
  localProfile,
  parse as parseProfile,
  type Profile,
} from './net/profile';
import { rankFor } from './data/story';
import { unlockedWeapons } from './data/weapons';
import { contractsFor, contractBonus, metContracts, type Contract } from './data/contracts';
import {
  STAGES,
  progressOf as stageProgressOf,
  stageAt,
  stageUnlocked,
} from './data/campaign';
import {
  connectX,
  connectedX,
  disconnectX,
  takeRedirectResult,
  xConnectAvailable,
  type XProfile,
} from './net/xconnect';
import { el, button } from './ui/dom';
import { connect, askDeviceId, hostLanguage, isTestnet, type WalletSession } from './nimiq/wallet';
import { settle } from './nimiq/payments';
import { challengeShareLink, clanShareLink, readChallengeId, readClanTag } from './nimiq/deeplink';
import { capture, matches, restore, type RunSnapshot } from './game/snapshot';
import { buy } from './game/consume';
import { CONSUMABLES } from './data/consumables';
import { signClaim } from './nimiq/wallet';
import { renderSettings } from './ui/settings';
import { CAR_REACH, carStopped } from './game/car';
import { answerNode } from './game/node';
import { answerGate } from './game/ally';

type Screen =
  | 'loading'
  | 'splash'
  | 'intro'
  | 'gate'
  | 'controls'
  | 'about'
  | 'settings'
  | 'loadout'
  | 'clan'
  | 'campaign'
  | 'dispatch'
  | 'signals'
  | 'brief'
  | 'run'
  | 'results'
  | 'board'
  | 'challenge';

/** Default stake when a player creates a challenge without picking one. */
const DEFAULT_STAKE_NIM = 5;

/**
 * Floor on how long the loading screen is shown.
 *
 * Long enough to read the three checks it is reporting. A warm load resolves in
 * a few hundred milliseconds and without this the screen is a flicker.
 */
const MIN_LOADING_MS = 3200;

const STAGE_KEY = 'sface.stage';

/** The stage last selected, or one. Clamped, because storage is editable. */
function readStage(): number {
  try {
    const raw = Number(localStorage.getItem(STAGE_KEY));
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(STAGES.length, Math.floor(raw)));
  } catch {
    return 1;
  }
}

/**
 * The run in progress, kept for exactly as long as the tab is.
 *
 * sessionStorage rather than localStorage on purpose. A half-finished run is
 * something you came back to, not something you keep: closing the tab and
 * opening the game tomorrow should start tomorrow's mission, not resume a
 * stage from a coin that is no longer the worst performer. A refresh, a
 * reclaimed background tab and a WebView reload all keep the session, which is
 * every case this exists for.
 */
/**
 * How far the campaign has been taken, on this device.
 *
 * Progression used to be read only from the server profile, which meant a
 * cleared stage that failed to post left the player on Run it again with no
 * way forward: they had beaten the stage, the game had judged it beaten, and
 * the button still would not appear because a leaderboard had not confirmed it.
 * A campaign is single player. It has no business waiting on a network.
 *
 * The board is still the authority on Face and rank, which are competitive and
 * verified. This is only the answer to which stages are open, and the two are
 * reconciled by taking whichever has seen more.
 */
const CLEARED_KEY = 'sface.cleared';

function readCleared(): number {
  try {
    const raw = Number(localStorage.getItem(CLEARED_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

function writeCleared(stage: number): void {
  try {
    // Never downward. Re-running an early stage is not losing the later ones.
    if (stage > readCleared()) localStorage.setItem(CLEARED_KEY, String(stage));
  } catch {
    // Blocked storage. The server profile still carries it when it can.
  }
}

const RUN_KEY = 'sface.run';

function readSnapshot(): RunSnapshot | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as RunSnapshot) : null;
  } catch {
    // Blocked storage, or a blob written by an older build. Either way there is
    // no run to come back to, which is exactly where we were before this.
    return null;
  }
}

function writeSnapshot(snapshot: RunSnapshot): void {
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(snapshot));
  } catch {
    // Quota, or private mode. Losing the resume is not worth losing the run.
  }
}

function clearSnapshot(): void {
  try {
    sessionStorage.removeItem(RUN_KEY);
  } catch {
    // As above.
  }
}

function writeStage(stage: number): void {
  try {
    localStorage.setItem(STAGE_KEY, String(stage));
  } catch {
    // Private mode. The choice simply does not survive the session.
  }
}


class App {
  private readonly ui: HTMLElement;
  /** The app bar. Lives outside #ui so a screen repaint cannot flicker it. */
  private readonly chrome: HTMLElement;
  private readonly renderer: Renderer;
  private readonly camera = new Camera();
  private readonly hud = new Hud();
  private readonly effects = new Effects();
  private readonly input: Input;
  private readonly loop: GameLoop;

  /** Ghosts and live players, drawn through one path. See game/squad.ts. */
  private readonly squad = new Squad();
  private readonly recorder = new GhostRecorder();
  private live: LiveLink | null = null;
  /** Traces fetched for today's seed, held so a replay does not refetch. */
  private ghostPool: Array<{ id: string; name: string; score: number; frames: GhostFrame[] }> = [];

  private screenValue: Screen = 'loading';
  private mission: DailyMission | null = null;
  private notice: string | null = null;
  private run: RunState | null = null;

  private session: WalletSession | null = null;
  /**
   * Always present. Starts as a locally generated identifier so squadmates,
   * co-op and the board work everywhere, and upgrades to the Nimiq device
   * identifier after the first run if the player grants it. See net/identity.
   */
  private pilot: string = pilotId();
  /** True once the stronger Nimiq identifier has been asked for. */
  private askedForDeviceId = false;

  /** The connected X account, whose picture rides on the character's head. */
  /**
   * The connected account.
   *
   * takeRedirectResult first: on the very load that comes back from X the
   * profile is in the URL fragment and not yet in storage, so reading the cache
   * alone would show a player who just signed in as still signed out. It falls
   * through to the cache on every other load, and returns null when there is
   * neither.
   */
  /**
   * The profile carried back in the URL fragment by the X sign-in redirect.
   *
   * Read exactly once, here, because takeRedirectResult consumes the fragment.
   * Anything asking later gets null, which is why both the flag below and `me`
   * derive from this field rather than calling it again.
   */
  private readonly redirected: XProfile | null = takeRedirectResult();

  /** True when this page load is the one returning from signing in with X. */
  private readonly cameBackFromX: boolean = this.redirected !== null;

  /**
   * True when this load was caused by something the player did in the app.
   *
   * Switching network is the only one today, and it reloads because a live swap
   * would leave screens holding a mixture of two networks. Read once at
   * construction, because reading it clears it.
   */
  private readonly inAppReload: boolean = takeInAppReload();

  private me: XProfile | null = this.redirected ?? connectedX();
  /** False until the service confirms X connect is configured here. */
  private xAvailable = false;
  /**
   * True while flying a run that will never be saved.
   *
   * Set by the practice button on the gate and cleared the moment a real run
   * starts, so it can never leak into a signed-in player's submission. Every
   * persistence path checks it rather than checking for an X handle, because
   * "this run does not count" is a property of the run and not of the person.
   */
  private practice = false;

  /**
   * True while the stage brief is on screen, and the run is held.
   *
   * Holding is the point. The card is an explainer, and a player reading it is
   * not playing, so letting attackers move and the clock drain behind it takes a
   * stage away from somebody who was doing what they were asked to do.
   *
   * This was briefly the other way round, live underneath the card, because
   * controls appeared dead at the start of a run. That turned out to be two
   * separate faults: this freeze, and a fire pad that could not aim at all. With
   * the pad fixed and the card capped at five seconds, holding is simply a short
   * briefing rather than a game that ignores you.
   *
   * Freezing also sidesteps the clock question entirely. Nothing has to be given
   * back, so `seconds` stays readonly and the service's score ceiling still
   * matches what the client had.
   */
  /** Cancels a brief that is still on screen. See ui/brief.ts. */
  private briefing = false;
  /** Latched for one clear, so the campaign ending cannot repeat. */
  private endingShown = false;
  private cancelBrief: (() => void) | null = null;
  /**
   * True when the last refusal was "you need a wallet" rather than an error.
   *
   * Kept separate from the notice text so the UI can offer the deeplink out
   * instead of matching on a sentence, which would break the moment the copy
   * is reworded or translated.
   */
  private needsWallet = false;

  /** The pilot's record. Rendered from the local mirror before the fetch lands. */
  private profile: Profile | null = localProfile();
  /** Set when the run just finished crossed a tier. Cleared on the next run. */
  private rankedUp: string | null = null;
  /** Set when the run just finished opened a new gun. Cleared on the next run. */
  private unlockedWeapon: string | null = null;
  /** Which board tab was last open. Remembered across visits. */
  private boardTab: BoardTab = 'daily';
  /** Which page of it. Reset whenever the tab changes. */
  private boardPage = 0;

  /** Clan state. All of it is cached so reopening the screen is instant. */
  private clanTable: ClanRow[] = [];
  private myClan: ClanDetail | null = null;
  private clanLoading = false;
  private clanBusy = false;
  private clanNotice: string | null = null;
  /** A tag off an invite link, so an invited player only has to tap join. */
  private invitedTag: string | null = null;
  /** A tag we have asked to join and are waiting on the owner for. */
  private awaitingTag: string | null = null;

  /** CT Signals. Nothing here is persisted; see server/xsignals.ts. */
  private signals: Signals | null = null;
  private signalsLoading = false;
  private signalsBusy = false;
  private signalsNotice: string | null = null;

  /**
   * The stage about to be flown. Defaults to the next one not yet cleared, so
   * a returning player presses start and gets the thing they are up to.
   */
  /**
   * The stage the player has selected, remembered across loads.
   *
   * Reported as refreshing dropping them back to stage one. It used to live
   * only in memory, so any reload lost the choice, and on the last stages that
   * means walking back through the campaign screen every time. Somebody working
   * on stage six should reload onto stage six.
   *
   * Stored rather than derived from progress, because they are different
   * questions: what you have unlocked, and which one you are currently playing.
   * A player replaying stage three to beat a score has not un-cleared anything.
   */
  private stage = readStage();
  /** Set when the run just finished cleared its stage. Cleared on the next run. */
  private stageCleared = false;
  /** Today's three jobs for the selected stage. Recomputed when either changes. */
  private contracts: Contract[] = [];
  /** Which of them the finished run met. */
  private contractsMet: Contract[] = [];

  /** Boot progress. Each entry flips when the work behind it actually lands. */
  private steps: LoadStep[] = initialSteps();
  /** True while the run is held. The loop still draws; it just does not step. */
  private paused = false;

  private firstRun = true;
  private lastHealth = 0;
  /** Dev-only steering, set by debug().advance. Null in every normal frame. */
  private commandOverride: PlayerCommand | null = null;
  private rank: number | null = null;
  private cardUrl: string | null = null;
  /**
   * The card as a File, converted the moment it is drawn. Share cannot await
   * for it: the wait costs the click's activation and the sheet refuses. See
   * shareRun in ui/share.ts.
   */
  private cardShareFile: File | null = null;
  private postError: string | null = null;

  private challenge: Challenge | null = null;
  private pendingChallengeId: string | null = null;
  private challengeNotice: string | null = null;
  private settling = false;

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>('#stage');
    const ui = document.querySelector<HTMLElement>('#ui');
    const chrome = document.querySelector<HTMLElement>('#chrome');
    if (!canvas || !ui || !chrome) {
      throw new Error('The page is missing #stage, #ui or #chrome.');
    }

    this.ui = ui;
    this.chrome = chrome;
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    // The pad layout needs a count, and this is the only place that knows it.
    this.input.slotCount = CONSUMABLES.length;
    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);

    // Escape toggles the hold. Bound here rather than in Input, because pausing
    // is a thing the app does, not a way of steering the ship. Shift was tried
    // and is wrong: it is a modifier people hold while doing something else.
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.repeat) return;
      if (this.screen !== 'run') return;
      event.preventDefault();
      this.setPaused(!this.paused);
    });

    /*
     * Switching away pauses, but coming back does not resume.
     *
     * A run whose clock keeps going while the tab is hidden is a run somebody
     * loses to a notification, and resuming automatically drops them straight
     * back into a fight they are not looking at yet.
     */
    // Relabel the toggle when the browser changes it from under us, which it
    // does every time somebody leaves fullscreen with Escape.
    onFullscreenChange(() => {
      this.onResize();
      if (this.screen === 'brief') this.showBrief();
    });

    /*
     * Leaving the app silences it. Coming back restores what was playing.
     *
     * Reported from a phone: minimising sFace left it playing over everything
     * else. A browser tab is permitted to do that and a game has no business
     * doing it, so the sound follows the app rather than the process.
     *
     * The run is paused as well, which it already was: a clock that keeps going
     * while you are looking at something else is a run lost to a notification.
     * Coming back deliberately does NOT unpause, because resuming automatically
     * drops somebody into a fight they have not looked at yet.
     */
    /*
     * A refresh is not a decision, so it must not cost the run.
     *
     * pagehide fires on reload, on close, and when a phone browser evicts the
     * tab to reclaim memory. None of those are the player choosing to stop, and
     * until now all three threw away everything since the stage began. On a
     * phone the eviction case is the common one and there is nothing to blame:
     * you come back and the run is simply gone.
     */
    window.addEventListener('pagehide', () => this.saveRun());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Hidden is one step from evicted, so bank it here too rather than
        // relying on pagehide firing at all. Some engines skip it.
        this.saveRun();
        this.setPaused(true);
        music.suspend();
        audio.silence();
        return;
      }

      audio.wake();

      // Paused screens are quiet on purpose, so a run that is still paused gets
      // its music back only when the player actually resumes.
      if (this.screen === 'run' && this.paused) return;
      music.resume(this.screen === 'run' ? 'run' : 'menu');
    });

    this.onResize();
  }

  async boot(): Promise<void> {
    // The host seeds its language synchronously before this script runs, so
    // the very first paint is already in the player's language. The docs are
    // explicit that a mini app must not assume it from the device locale.
    setLanguage(hostLanguage());
    renderLoading(this.ui, this.steps);
    const bootAt = Date.now();

    /*
     * Progress belongs to the account, not to the device it was earned on.
     *
     * Resolved before anything reads `pilot`, which is every call below: the
     * board, the profile, ghosts, clans and challenges all hang off it. Getting
     * this wrong by a few lines would post today's run against the device and
     * leave the account short.
     *
     * A device that has played before is folded in on the way past, so signing
     * in keeps whatever was earned anonymously rather than starting over.
     */
    await this.adoptAccount();

    // The wallet probe runs alongside the mission fetch rather than before it.
    // Whichever finishes first, the player is not waiting on the other.
    void this.probeWallet();

    this.pendingChallengeId = readChallengeId();
    this.invitedTag = readClanTag();

    /*
     * The mission and the record are fetched together; the squad is not.
     *
     * Ghost traces are keyed on the mission's seed, so they cannot even be
     * asked for until the mission has landed. Waiting for them would put a
     * second round trip in front of a player who has not seen the game yet,
     * to populate something that is a bonus. They load in the background once
     * the brief is up, and are ready long before anyone presses start.
     *
     * The record is small and usually beats the mission home, so pairing it
     * costs nothing and means the rank strip is correct on its first paint.
     * Neither call rejects: both resolve to null on failure.
     */
    const [{ mission, notice }] = await Promise.all([
      loadMission().then((result) => {
        this.markStep('market');
        return result;
      }),
      this.refreshProfile().then(() => this.markStep('record')),
    ]);

    this.mission = mission;
    this.notice = notice;
    setLanguage(this.session?.language ?? hostLanguage());

    this.prepareRun();
    this.loop.start();

    /*
     * Hold the loader for a beat even when everything was already cached.
     *
     * On a warm load the mission comes back in under a second and the loading
     * screen flashes past, which reads as a glitch rather than as a game
     * starting: three checks tick over faster than the eye resolves them and the
     * player is somewhere else before they knew they had arrived.
     *
     * So it is given a floor. Nothing is being faked, the steps are still real
     * awaits and a slow connection still takes as long as it takes. This only
     * stops a fast one from being invisible.
     */
    const elapsed = Date.now() - bootAt;
    if (elapsed < MIN_LOADING_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_MS - elapsed));
    }

    /*
     * The opening plays once per session.
     *
     * The flag lives in session storage, so somebody arriving gets the story and
     * a refresh does not replay it. Both extremes have been tried and both were
     * wrong: once ever meant the live site had no onboarding at all for anybody
     * but its first visitor, and every load meant refreshing sat you through it
     * again. See ui/intro.ts.
     *
     * It sits after the loop has started so the chart is alive behind it, and
     * after the mission has loaded so nothing in it is a guess.
     */
    /*
     * Except on the load that comes back from X.
     *
     * Signing in is a full page redirect, so the app boots again from scratch.
     * Playing the opening there means somebody who just authorised an account is
     * made to sit through the pitch a second time and lands on the front door
     * rather than on the screen they were sent back to.
     */
    const returningFromX = this.cameBackFromX;

    if (!introSeen() && !this.pendingChallengeId && !returningFromX && !this.inAppReload) {
      this.ui.className = '';
      this.screen = 'intro';
      renderIntro(this.ui, {
        voice: music.on,
        onBegin: () => this.startSound(),
        // The brand beat, then the home page. The splash is the punctuation
        // between the story ending and the game starting; without it the last
        // line of the pitch cuts straight to a sign-in button.
        onDone: () => void this.enter(),
      });
    }

    // Fetched in the background. Squadmates are a bonus, never a gate on
    // starting a run, so nothing below waits on this.
    void this.loadGhosts();
    void this.probeXConnect();
    void this.refreshProfile();
    this.renderer.preload(this.me?.avatarUrl);
    for (const entry of mission.roster) this.renderer.preload(entry.avatarUrl);

    if (this.pendingChallengeId) await this.openChallenge(this.pendingChallengeId);
    else if (this.screen !== 'intro') this.landing();
  }

  /**
   * The first screen after boot.
   *
   * Normally the brief. An unattached pilot who arrived on a clan invite gets
   * the clan screen instead, with the tag already in the field, because landing
   * them on the brief would mean the link they tapped did nothing visible and
   * they would have to go looking for what it was for.
   */
  /**
   * The full splash, then the game.
   *
   * Deliberately three seconds rather than as short as possible. It is the one
   * moment the product is a poster rather than a page, and it happens once on
   * the way in. See ui/splash.ts.
   */
  private async enter(then?: () => void): Promise<void> {
    this.ui.className = '';
    this.screen = 'splash';
    renderSplash(this.ui);

    await new Promise((resolve) => setTimeout(resolve, SPLASH_FULL_MS));

    if (then) then();
    else this.landing();
  }

  /**
   * A short splash between two screens.
   *
   * Only where the destination is a change of place rather than a step: the
   * campaign, the rack, the clan hall. Putting it on every button would turn a
   * brand moment into a toll booth.
   */
  private async cross(then: () => void): Promise<void> {
    this.ui.className = '';
    this.screen = 'splash';
    await splashPause(this.ui);
    then();
  }

  private landing(): void {
    if (this.invitedTag && !this.profile?.clanTag) {
      this.openClan();
      return;
    }

    // A run banked by a refresh comes back before anything else, because the
    // player was in the middle of it and everything else can wait.
    if (this.resumeRun()) return;

    this.showBrief();
  }

  /**
   * Pull the best recorded runs on today's seed. They fly beside you next run.
   *
   * This is what makes a solo game feel populated on day one: the first player
   * of the day flies alone, and everyone after them flies with whoever came
   * before. No matchmaking, no lobby, no waiting for a second human.
   */
  /**
   * Point this session at the connected account's record, and absorb the
   * device's.
   *
   * Silent by design. Nothing in the UI mentions that an account carries
   * progress, because the pitch is Nimiq Pay and a second story about what X
   * unlocks would blur it. The behaviour is simply correct.
   */
  private async adoptAccount(): Promise<void> {
    const handle = this.me?.handle;
    if (!handle) return;

    const key = await accountKey(handle);
    // No SubtleCrypto here, so the device id stands. Same behaviour as before
    // accounts carried progress, which is a fine floor.
    if (!key || key === this.pilot) return;

    const device = this.pilot;
    this.pilot = key;

    /*
     * Merge is fire and forget, and idempotent on the service.
     *
     * Waiting on it would put a network round trip in front of the loading
     * screen for something the player never sees, and the service deletes the
     * source once folded in, so a retry or a second sign-in cannot double count.
     */
    void mergeProfile(device, key).then((merged) => {
      // Repaint the rank chip if the totals just changed under it.
      if (merged) void this.refreshProfile();
    });
  }

  private async loadGhosts(): Promise<void> {
    const mission = this.mission;
    if (!mission || !apiConfigured()) return;

    const result = await fetchGhosts(mission.seed, this.pilot, 4);
    if (!result.ok) return;

    this.ghostPool = result.value.flatMap((record) => {
      // decodeTrace is the trust boundary for this data. A malformed or
      // hostile trace becomes a missing squadmate, never an exception.
      const frames = decodeTrace(record.trace);
      if (!frames || frames.length === 0) return [];
      return [{ id: record.id, name: record.name, score: record.score, frames }];
    });
  }

  /**
   * What other players see. A connected handle beats a generated pilot name
   * every time: "@vitalikbuterin beat you" is a story, "Pilot 4F2A beat you"
   * is a row in a table.
   */
  private displayName(): string {
    return this.me ? `@${this.me.handle}` : pilotName(this.pilot);
  }

  /**
   * Replace the local mirror with the server's copy.
   *
   * The mirror has already painted a rank by the time this lands, so a
   * disagreement resolves quietly rather than flashing a wrong number. Only
   * re-renders when the brief is up, since anywhere else the strip is not
   * on screen to correct.
   */
  private async refreshProfile(): Promise<void> {
    const profile = await fetchProfile(this.pilot);
    if (!profile) return;

    this.profile = profile;
    if (this.screen === 'brief') this.showBrief();
    // The rack is drawn from lifetime Face, so a record that lands while it is
    // open would otherwise show yesterday's unlocks until the player backed out.
    else if (this.screen === 'loadout') this.showLoadout();
    // Same for the clan tag, which the record is also authoritative for.
    else if (this.screen === 'clan') this.paintClan();
    // And the campaign, whose unlocks are the record.
    else if (this.screen === 'campaign') this.showCampaign();
  }

  /**
   * Open the audio taps. Must be called from inside a real user gesture.
   *
   * Both unlocks are idempotent, so every plausible entry point calls this:
   * the intro's opening tap, and Start the run for anyone who skipped the
   * intro or came in through a challenge link.
   */
  private unlockSound(): void {
    audio.unlock();
    music.unlock();
  }

  /**
   * Open the taps and start the bed, from inside the opening tap.
   *
   * The title card is silent on purpose: it is the first thing anybody sees and
   * a game that starts making noise before you have touched it is a game people
   * mute. Sound begins the moment they choose to go in, which is also the only
   * moment a mobile browser will allow it.
   */
  private startSound(): void {
    this.unlockSound();
    music.play('menu');
  }

  /** Tick a boot step and repaint, but only while the loader is still up. */
  private markStep(key: string): void {
    const step = this.steps.find((s) => s.key === key);
    if (!step || step.done) return;

    step.done = true;
    if (this.screen === 'loading') renderLoading(this.ui, this.steps);
  }

  /**
   * Pause. Shift on a keyboard, a button on glass.
   *
   * The loop keeps running and the world keeps drawing; only the simulation
   * step is skipped. That means the chart stays on screen behind the overlay
   * rather than freezing into a screenshot, and resuming has nothing to
   * restart.
   *
   * Input is cleared on the way in. Otherwise a thumb still on the glass, or a
   * key held when the tab lost focus, is remembered across the pause and the
   * ship lurches the moment play resumes.
   */
  /** Bank the run in progress, if there is one worth banking. */
  private saveRun(): void {
    const run = this.run;

    // A finished run is a results screen, and a preview was never going to be
    // kept. Neither is something to come back to.
    if (!run || this.screen !== 'run' || run.finished || run.preview) {
      return;
    }

    writeSnapshot(capture(run));
  }

  /**
   * Pick a banked run back up, paused.
   *
   * Paused rather than running, for the same reason coming back from a
   * notification does not unpause: dropping somebody straight into a fight they
   * have not looked at yet is how you lose the run a second time.
   */
  private resumeRun(): boolean {
    const mission = this.mission;
    const snapshot = readSnapshot();

    if (!mission || !snapshot || !matches(snapshot, mission.seed)) {
      // A snapshot from a different mission describes a level that no longer
      // exists. Midnight UTC redraws the world.
      if (snapshot) clearSnapshot();
      return false;
    }

    // A different gun is a different run. Rebuilding under the current loadout
    // would hand back a run nobody played.
    if (snapshot.weapon !== this.weapon().id) {
      clearSnapshot();
      return false;
    }

    this.stage = snapshot.stage;
    this.practice = snapshot.practice;
    this.contracts = this.todaysContracts();
    this.prepareRun();

    const run = this.run;
    if (!run) {
      clearSnapshot();
      return false;
    }

    restore(run, snapshot);

    this.firstRun = false;
    this.screen = 'run';
    this.paused = false;
    this.setPaused(true);
    return true;
  }

  private setPaused(paused: boolean): void {
    if (this.screen !== 'run' || this.paused === paused) return;

    this.paused = paused;
    this.input.reset();

    if (paused) {
      music.duck();
      renderPause(this.ui, {
        onResume: () => this.setPaused(false),
        onQuit: () => {
          this.paused = false;
          this.ui.className = '';
          // Deliberate, unlike a refresh, so the run is genuinely abandoned.
          clearSnapshot();
          this.showBrief();
        },
      });
    } else {
      music.play('run');
      this.showRunOverlay();
    }
  }

  /**
   * The in-run overlay: a pause control and nothing else.
   *
   * It lives in the same layer as every other screen, so the run has to opt
   * that layer out of being a solid sheet. `is-hud` makes it transparent and
   * click-through, and only the button itself takes input.
   */
  private showRunOverlay(): void {
    this.ui.className = 'is-hud';
    renderRunOverlay(this.ui, { onPause: () => this.setPaused(true) });
  }

  /**
   * The stage brief, then the run.
   *
   * Shown on every stage including the ones a player has flown fifty times,
   * because the alternative is a card that appears on some runs and not others
   * and nobody can tell which rule decides. It is skippable with any tap or key,
   * which is what makes that affordable.
   */
  private showStageBrief(): void {
    const run = this.run;
    if (!run) {
      this.showRunOverlay();
      return;
    }

    // Any brief still on screen from an abandoned run goes first, or two cards
    // stack and the second one's timer starts a run under the first.
    this.cancelBrief?.();
    this.briefing = true;

    this.cancelBrief = showBriefCard(this.ui, {
      stage: run.stage,
      mission: run.mission,
      onDone: () => {
        this.briefing = false;
        this.cancelBrief = null;
        // Drop anything held during the card, so a thumb that was already down
        // does not fling the player the moment control returns.
        this.input.reset();
        // Only take over the layer if the player is still here. Quitting during
        // the brief leaves them on another screen, and painting the run overlay
        // on top of it would strand them.
        if (this.screen === 'run') this.showRunOverlay();
      },
    });
  }

  /** Only offer Connect X where the service is actually configured for it. */
  private async probeXConnect(): Promise<void> {
    this.xAvailable = await xConnectAvailable();
    if (this.xAvailable && this.screen === 'brief') this.showBrief();
  }

  private async probeWallet(): Promise<void> {
    this.session = await connect();
    setLanguage(this.session.language);
    // Re-render whatever is up, since the language may have just changed.
    if (this.screen === 'brief') this.showBrief();
  }

  // Screens ---------------------------------------------------------------

  /**
   * The current screen, behind an accessor so the bar cannot fall out of step.
   *
   * There are a dozen places that move between screens, and a bar repainted by
   * hand at each of them is a bar that is eventually wrong at one of them. The
   * setter is the single hook: change the screen, the bar follows.
   */
  private get screen(): Screen {
    return this.screenValue;
  }

  private set screen(next: Screen) {
    this.screenValue = next;
    this.paintChrome();
  }

  /**
   * Screens that get the bar.
   *
   * The three that do not are each a single focal point: the loading screen is
   * one bar filling, the intro is one line at a time, and a run is the game.
   * Furniture across the top of any of them is in the way.
   */
  private paintChrome(): void {
    const screen = this.screenValue;
    if (screen === 'loading' || screen === 'splash' || screen === 'intro' || screen === 'run') {
      hideChrome(this.chrome);
      return;
    }

    renderChrome(this.chrome, {
      mission: this.mission,
      profile: this.profile,
      clanTag: this.profile?.clanTag ?? null,
      onHome: () => this.playIntro(),
      onRank: () => void this.showBoard('allTime'),
    });
  }

  /**
   * The opening, on demand.
   *
   * One entry point for the wordmark and for the replay button, because two
   * copies of this is two places for the audio unlock to be forgotten. It ends
   * on the brief rather than on `landing()`: somebody who deliberately went
   * back to the front door does not want to be redirected to a clan invite on
   * the way out.
   */
  private playIntro(): void {
    this.ui.className = '';
    this.screen = 'intro';
    renderIntro(this.ui, {
      voice: music.on,
      onBegin: () => this.startSound(),
      onDone: () => void this.enter(() => this.showBrief()),
    });
  }

  /**
   * Today's three jobs for the stage about to be flown.
   *
   * Derived rather than stored, because it is a pure function of the mission
   * and the stage and caching it is one more thing that can be stale. See
   * data/contracts.ts for why they are generated from the seed.
   */
  private todaysContracts(): Contract[] {
    const mission = this.mission;
    if (!mission) return [];

    return contractsFor({
      seed: mission.seed,
      ticker: mission.ticker,
      changePct: mission.changePct,
      fearGreed: mission.fearGreed,
      roster: mission.roster.map((r) => r.handle),
      topics: mission.story?.topics ?? [],
      stage: this.activeStage(),
    });
  }

  /**
   * Must this visitor sign in with X before the main flow opens?
   *
   * Only on the public web, and only when X connect is actually configured. A
   * deployment without X credentials must never lock anybody out of a game it
   * cannot let them into, which is why xAvailable is part of the test rather
   * than an assumption.
   *
   * Inside Nimiq Pay this is always false: the wallet is the identity there
   * and X is an upgrade offered on the home page, so gating would be asking
   * the same person to prove themselves twice.
   */
  private gated(): boolean {
    if (this.session?.available) return false;
    if (this.me) return false;
    return this.xAvailable;
  }

  /**
   * Wrap a destination that only means something with a name attached.
   *
   * A leaderboard, a clan, a campaign record and CT Signals are all answers to
   * "who are you", so for somebody flying practice they would be four empty
   * rooms. Sending them back to the door with a reason is more honest than
   * showing a rank of nothing, and far more honest than hiding the tiles, which
   * would misrepresent how much game is actually here.
   *
   * The Dispatch is deliberately NOT wrapped. It is the one screen that is
   * worth reading with no account at all, and it is the best argument the app
   * has for why an X account belongs here.
   */
  private needsName(what: string, go: () => void): () => void {
    return () => {
      if (this.practice && this.gated()) {
        this.notice = `${what} needs to know who you are. Sign in with X.`;
        this.showGate();
        return;
      }
      go();
    };
  }

  /** The front door. Sign in with X, or fly a run that does not count. */
  private showGate(): void {
    this.ui.className = '';
    this.screen = 'gate';

    renderGate(this.ui, {
      notice: this.notice,
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,
      onPractice: () => {
        this.practice = true;
        void this.cross(() => this.showBrief());
      },
    });
    this.notice = null;
  }

  private showSettings(): void {
    this.ui.className = '';
    this.screen = 'settings';
    renderSettings(this.ui, {
      onBack: () => this.showBrief(),
      onChange: () => this.showSettings(),
    });
  }

  private showBrief(): void {
    const mission = this.mission;
    if (!mission) return;

    // The gate stands in front of the home page, not in front of the game, so
    // it is enforced here where every route home converges rather than at each
    // of the dozen call sites that lead back.
    if (this.gated() && !this.practice) {
      this.showGate();
      return;
    }

    this.ui.className = '';

    this.screen = 'brief';
    renderBrief(this.ui, {
      mission,
      notice: this.notice,
      showHints: this.firstRun,
      me: this.meChip(),
      profile: this.profile,
      testnet: isTestnet(this.session?.network ?? null),
      network: this.session?.network ?? null,
      soundOn: music.on,
      onToggleSound: () => {
        // One switch for everything audible: the bed, the sting, the blips
        // and the narrator. Two separate toggles would be a settings screen.
        const on = music.toggle();
        if (audio.on !== on) audio.toggle();
        narrator.setMuted(!on);
        this.showBrief();
      },
      weaponName: this.weapon().name,
      onLoadout: () => void this.cross(() => this.showLoadout()),
      clanTag: this.profile?.clanTag ?? null,
      onClan: this.needsName('Clans', () => void this.cross(() => this.openClan())),
      stage: stageAt(this.activeStage()),
      stagesCleared: this.cleared(),
      contracts: this.todaysContracts(),
      // Deliberately NOT gated. The campaign is where a practice player picks
      // which stage to taste, so locking it would hide the reason to sign in.
      onCampaign: () => void this.cross(() => this.showCampaign()),
      onDispatch: () => void this.cross(() => this.showDispatch()),
      onSignals: this.needsName('CT Signals', () => void this.cross(() => this.openSignals())),
      fullscreen: isFullscreen(),
      onFullscreen: fullscreenAvailable()
        ? () => void toggleFullscreen()
        : null,
      onAbout: () => void this.cross(() => this.showAbout()),
      onControls: () => this.showControls(),
      onSettings: () => {
        this.ui.className = '';
        this.screen = 'settings';
        renderSettings(this.ui, {
          onBack: () => this.showBrief(),
          // Re-render in place rather than bouncing home, so a player trying
          // the three schemes can feel the difference without losing the page.
          onChange: () => this.showSettings(),
        });
      },
      onReplayIntro: () => this.playIntro(),
      onStart: () => this.startRun(),
      onBoard: this.needsName('The leaderboard', () => void this.showBoard()),
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,
    });
  }

  /**
   * The gun this pilot may actually fly with right now.
   *
   * Resolved against the record rather than against what is in storage, so a
   * choice made on a device that has since been reset falls back to the
   * sidearm instead of granting something unearned. Cheap enough to call on
   * every render.
   */
  private weapon() {
    return resolveWeapon(this.profile?.lifetimeFace ?? 0);
  }

  private showLoadout(): void {
    this.ui.className = '';
    this.screen = 'loadout';

    renderLoadout(this.ui, {
      lifetimeFace: this.profile?.lifetimeFace ?? 0,
      selected: this.weapon().id,
      onSelect: (id) => {
        chooseWeapon(id);
        audio.play('ui');
        this.showLoadout();
      },
      onBack: () => this.showBrief(),
    });
  }

  // The campaign ----------------------------------------------------------

  /** Highest stage cleared, from the record. Zero for a new pilot. */
  private cleared(): number {
    // Whichever has seen more. The profile leads on a fresh device that has
    // played elsewhere; the local record leads when a post could not be made.
    const known = Math.max(this.profile?.stagesCleared ?? 0, readCleared());
    return Math.max(0, Math.min(STAGES.length, known));
  }

  /**
   * The stage a run will actually use.
   *
   * Clamped against the record on the way out rather than trusted from state,
   * for the same reason the weapon is: a selection made before a reset would
   * otherwise hand somebody Stage 7 on their first night and skip the six
   * things it is a resolution to.
   */
  private activeStage(): number {
    // Practice opens every stage as a taster, so the campaign's unlock rule
    // does not apply and must not quietly drag the choice back to stage one.
    if (this.practice) return Math.max(1, Math.min(STAGES.length, this.stage));

    const cleared = this.cleared();
    return stageUnlocked(this.stage, cleared) ? this.stage : Math.min(STAGES.length, cleared + 1);
  }

  /**
   * What crypto X did today.
   *
   * The read that builds the mission already knows all of this; until now it
   * was thrown away after one headline. See ui/dispatch.ts.
   */
  private showDispatch(): void {
    const mission = this.mission;
    if (!mission) return;

    this.ui.className = '';
    this.screen = 'dispatch';

    renderDispatch(this.ui, {
      mission,
      onBack: () => this.showBrief(),
      onOpen: (url) => {
        // Opened straight from the click so the popup blocker does not eat it.
        // The same lost-activation bug broke Share. See ui/share.ts.
        window.open(url, '_blank', 'noopener,noreferrer');
      },
    });
  }

  /**
   * CT Signals: who publicly engages this player, and what they fly for.
   *
   * Painted first, fetched second, same split as the clan screen and for the
   * same reason: a render that starts its own fetch and then repaints is how
   * the clan screen ended up looping against the service.
   */
  private openSignals(): void {
    this.paintSignals();
    void this.loadSignals();
  }

  private paintSignals(): void {
    this.ui.className = '';
    this.screen = 'signals';

    renderSignals(this.ui, {
      handle: this.me?.handle ?? null,
      signals: this.signals,
      loading: this.signalsLoading,
      busy: this.signalsBusy,
      notice: this.signalsNotice,
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,
      onUnlock: () => void this.unlockDeepRead(),
      onBack: () => this.showBrief(),
      needsWallet: this.needsWallet,
    });
  }

  private async loadSignals(depth: 'glance' | 'full' = 'glance'): Promise<void> {
    const handle = this.me?.handle;
    if (!handle || !apiConfigured()) return;

    this.signalsLoading = true;
    if (this.screen === 'signals') this.paintSignals();

    const result = await fetchSignals(handle, this.pilot, depth);
    this.signalsLoading = false;

    if (result.ok) {
      this.signals = result.value;
      this.signalsNotice = null;
    } else {
      this.signalsNotice = result.error;
    }

    if (this.screen === 'signals') this.paintSignals();
  }

  /**
   * Pay for the deep read.
   *
   * The money goes straight to the treasury address the service names, exactly
   * like a challenge settlement, and the service is told afterwards. It is
   * reported rather than verified for the same reason and with the same
   * honesty about it: there is no Nimiq node here to check against.
   */
  private async unlockDeepRead(): Promise<void> {
    const signals = this.signals;
    if (!signals || this.signalsBusy) return;

    // No treasury configured means the deep read is simply free.
    if (!signals.treasury) {
      await this.loadSignals('full');
      return;
    }

    if (!this.session?.available) {
      this.signalsNotice = t('challengeNoWallet');
      this.needsWallet = true;
      this.paintSignals();
      return;
    }

    this.signalsBusy = true;
    this.signalsNotice = null;
    this.paintSignals();

    const paid = await settle({
      recipient: signals.treasury,
      amountNim: signals.priceNim,
      memo: `sFace signals ${utcDate()}`,
    });

    if (!paid.ok) {
      this.signalsBusy = false;
      this.signalsNotice = paid.reason;
      this.paintSignals();
      return;
    }

    const told = await unlockSignals({
      deviceId: this.pilot,
      serializedTx: paid.serializedTx,
    });

    this.signalsBusy = false;
    if (!told.ok) {
      // Paid on chain but the service did not hear. Say exactly that.
      this.signalsNotice =
        'Paid on chain, but the service did not record it. Your transaction is fine.';
      this.paintSignals();
      return;
    }

    await this.loadSignals('full');
  }

  /**
   * The documentation page: what sFace is, and why it lives on Nimiq.
   *
   * Reachable from the footer on every screen that has one, so somebody who
   * arrived cold and scrolled to the bottom looking for an explanation finds
   * one rather than a list of links.
   */
  private showControls(): void {
    this.ui.className = '';
    this.screen = 'controls';
    renderControls(this.ui, { onBack: () => this.showBrief() });
  }

  private showAbout(): void {
    this.ui.className = '';
    this.screen = 'about';

    renderAbout(this.ui, {
      onBack: () => this.showBrief(),
      onPlay: () => this.showBrief(),
      onGuide: () => this.showControls(),
    });
  }

  private showCampaign(): void {
    this.ui.className = '';
    this.screen = 'campaign';

    renderCampaign(this.ui, {
      cleared: this.cleared(),
      selected: this.activeStage(),
      practice: this.practice,
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,
      onSelect: (n) => {
        this.stage = n;
        writeStage(n);
        audio.play('ui');
        this.showCampaign();
      },
      onBack: () => this.showBrief(),
    });
  }

  // Clans -----------------------------------------------------------------

  /**
   * Open the screen and go and get the standings.
   *
   * Split from the paint deliberately. Painting used to kick off the fetch
   * itself, and since the fetch repaints when it lands, opening the screen
   * started an infinite loop of requests that only stopped when the service
   * began refusing them. Fetching is an entry-point decision, so it lives at
   * the entry point.
   */
  private openClan(): void {
    this.paintClan();
    void this.loadClans();
  }

  private paintClan(): void {
    this.ui.className = '';
    this.screen = 'clan';

    renderClan(this.ui, {
      meId: this.pilot,
      myTag: this.profile?.clanTag ?? null,
      awaiting: this.awaitingTag,
      mine: this.myClan,
      table: this.clanTable,
      loading: this.clanLoading,
      offline: !apiConfigured(),
      suggested: this.invitedTag,
      notice: this.clanNotice,
      busy: this.clanBusy,
      onJoin: (tag) => void this.setClan(tag),
      onLookup: async (tag) => {
        if (!apiConfigured()) return null;
        const found = await fetchClan(tag);
        if (!found.ok) return null;
        // An unclaimed tag comes back with no owner rather than a 404, which is
        // exactly the distinction the button needs.
        return { taken: found.value.ownerId !== null, owner: found.value.ownerName };
      },
      onLeave: () => void this.setClan(null),
      onCancelRequest: () => void this.setClan(null),
      onDecide: (memberId, approve) => void this.decideRequest(memberId, approve),
      onInvite: () => void this.inviteToClan(),
      onBack: () => this.showBrief(),
    });
  }

  private async loadClans(): Promise<void> {
    if (!apiConfigured()) return;

    // Only show a spinner when there is nothing cached to show instead. With a
    // table already on screen this fills in underneath, which is the whole
    // reason the last one was kept.
    if (this.clanTable.length === 0) {
      this.clanLoading = true;
      if (this.screen === 'clan') this.paintClan();
    }

    const tag = this.profile?.clanTag ?? null;

    // Both at once. The standings and your own clan are independent reads and
    // waiting for one to start the other would double the time on screen.
    const [table, mine] = await Promise.all([
      fetchClans(),
      tag ? fetchClan(tag) : Promise.resolve(null),
    ]);

    if (table.ok) this.clanTable = table.value;
    if (mine?.ok) this.myClan = mine.value;
    this.clanLoading = false;

    if (this.screen === 'clan') this.paintClan();
  }

  /**
   * Found a clan, ask to join one, or leave.
   *
   * One call, because from the service's side it is one write. What comes back
   * says which of the three actually happened, and the difference matters: a
   * free tag is founded on the spot, a taken one only sends a request.
   */
  private async setClan(tag: string | null): Promise<void> {
    if (this.clanBusy) return;

    if (tag !== null && !/^[A-Z0-9]{2,4}$/.test(tag)) {
      this.clanNotice = 'A clan tag is two to four letters or digits.';
      this.paintClan();
      return;
    }

    if (!apiConfigured()) {
      this.clanNotice = 'Clans need the service. Everything else still works.';
      this.paintClan();
      return;
    }

    this.clanBusy = true;
    this.clanNotice = null;
    this.paintClan();

    const result = await joinClan({ deviceId: this.pilot, name: this.displayName(), tag });
    this.clanBusy = false;

    if (!result.ok) {
      this.clanNotice = result.error;
      this.paintClan();
      return;
    }

    const updated = parseProfile(result.value.profile);
    if (updated) {
      this.profile = updated;
      cacheProfile(updated);
    }

    // Waiting on somebody is a real state and the screen has to be able to say
    // so, or a request reads as a join that silently did nothing.
    this.awaitingTag = result.value.pending[0] ?? null;

    const outcome = result.value.outcome;
    this.clanNotice =
      outcome.status === 'requested'
        ? `Asked to join ${outcome.tag}.${outcome.ownerName ? ` ${outcome.ownerName} decides.` : ''}`
        : null;

    // The invite has been acted on, so it should stop pre-filling the field.
    this.invitedTag = null;
    // The cached detail belongs to whichever clan they were in a second ago.
    // The table does not, so it stays up while the fresh one is fetched.
    this.myClan = null;
    this.paintClan();
    await this.loadClans();
  }

  /** The owner's answer. The service checks that we are the owner, not this. */
  private async decideRequest(memberId: string, approve: boolean): Promise<void> {
    const tag = this.profile?.clanTag;
    if (!tag || this.clanBusy) return;

    this.clanBusy = true;
    this.clanNotice = null;
    this.paintClan();

    const result = await decideClanRequest(tag, {
      deviceId: this.pilot,
      memberId,
      approve,
    });
    this.clanBusy = false;

    if (result.ok) this.myClan = result.value;
    else this.clanNotice = result.error;

    this.paintClan();
    // Approving changes the pooled total, so the standings are now stale.
    if (result.ok && approve) await this.loadClans();
  }

  private async inviteToClan(): Promise<void> {
    const tag = this.profile?.clanTag;
    if (!tag) return;

    const face = this.myClan?.face ?? 0;
    await shareLink(
      face > 0
        ? `Clan ${tag} has pulled ${face.toLocaleString()} Face out of the Collapse. Come and fly with us.`
        : `Starting clan ${tag} in sFace. Come and fly with us.`,
      clanShareLink(tag),
    );
  }

  /** The connected-account row on the brief, or null when not connected. */
  private meChip(): HTMLElement | null {
    const me = this.me;
    if (!me) return null;

    return el(
      'div',
      { class: 'me' },
      me.avatarUrl
        ? el('img', {
            class: 'me__avatar',
            src: me.avatarUrl,
            alt: '',
            referrerpolicy: 'no-referrer',
          })
        : el('div', { class: 'me__avatar' }),
      el(
        'div',
        {},
        el('div', { class: 'stat__label', text: t('connectedAs') }),
        el('div', { class: 'me__handle', text: `@${me.handle}` }),
      ),
      button(
        t('disconnectX'),
        () => {
          disconnectX();
          this.me = null;
          this.showBrief();
        },
        'quiet',
      ),
    );
  }

  private async doConnectX(): Promise<void> {
    const profile = await connectX();

    if (!profile) {
      // Declined, closed, or failed. All the same to the player, and none of
      // them are worth a red banner over a cosmetic feature.
      this.notice = t('connectXFailed');
      this.showBrief();
      return;
    }

    this.me = profile;
    // They have a name now, so nothing needs to be thrown away any more.
    this.practice = false;
    this.notice = null;
    // Decode it now so the first frame of the run already has a head on it.
    this.renderer.preload(profile.avatarUrl);
    this.showBrief();
  }

  private startRun(): void {
    // The first tap of the session is the only chance to start audio. Safe to
    // call repeatedly: both unlocks are idempotent.
    this.unlockSound();
    audio.play('ui');
    music.play('run');

    this.contracts = this.todaysContracts();
    this.prepareRun();
    this.firstRun = false;
    this.rank = null;
    this.rankedUp = null;
    this.unlockedWeapon = null;
    this.stageCleared = false;
    this.endingShown = false;
    this.cardUrl = null;
    this.cardShareFile = null;
    this.postError = null;
    this.screen = 'run';
    this.paused = false;
    // Starting deliberately discards whatever was banked. There is only ever
    // one run to come back to and this is now it.
    clearSnapshot();
    this.showStageBrief();
  }

  private prepareRun(): void {
    const mission = this.mission;
    if (!mission) return;

    // The weapon is decided here, once, rather than read every frame. A gun
    // that could change mid-run would make the recorded trace disagree with
    // the run that produced it.
    /*
     * A preview is for somebody who has told us nothing about themselves.
     *
     * Identity is the X account. It carries Face, rank, clan and history, and it
     * carries them across every device and every channel, so a player who has
     * connected one has a record to add to wherever they are playing. Gating
     * them behind the wallet would be gating them out of their own progress.
     *
     * The wallet is for money: staking a challenge, settling one, and signing a
     * score so it can be verified. Those paths still route to Nimiq Pay and
     * always will, because they are the ones that need a key rather than a name.
     *
     * So the short look is only for a stranger in a browser tab: no wallet and
     * no account. Anyone else gets the whole game.
     */
    const inWallet = this.session?.available === true;
    const knownPlayer = this.me !== null;

    this.run = new RunState(
      mission,
      this.weapon().id,
      this.activeStage(),
      this.practice,
      !inWallet && !knownPlayer,
    );

    /*
     * How much help the gun gets, decided here and nowhere else.
     *
     * Staked means a challenge is riding on this run, and a challenge is pinned
     * to the baseline every player has: two people betting NIM on one seed must
     * be playing the same game, the same reason the camera refuses to show a
     * desktop more of the world than a phone. See game/assist.ts.
     *
     * A practice run is never staked and a player with no profile yet gets the
     * baseline, so a first-timer on a phone still gets a gun that helps.
     */
    const staked = this.challenge !== null;
    this.run.assist = earnedAssist(
      { stagesCleared: this.profile?.stagesCleared ?? 0 },
      staked,
    );

    this.lastHealth = this.run.player.health;
    this.effects.clear();
    this.input.reset();
    this.recorder.reset();
    // The ring city is read at a distance, so the camera sits back from it.
    if (this.run.rings) this.camera.zoomOut(Camera.RING_ZOOM_OUT);

    // A city has no ground line to bias toward, so it gets the free camera.
    if (this.run.city) {
      this.run.player.x = this.run.city.startX;
      this.run.player.y = this.run.city.startY;
      this.camera.jumpToFree(this.run.player, this.run.city);
    } else {
      this.camera.jumpTo(this.run.player, this.run.terrain.groundAt(this.run.player.x));
    }

    // Ghosts are re-seated from the pool each run, so restarting replays them
    // from the top rather than leaving them frozen wherever they finished.
    this.squad.clear();
    for (const ghost of this.ghostPool) {
      this.squad.addGhost(ghost.id, ghost.name, ghost.score, ghost.frames);
    }

    this.connectLive();
  }

  /**
   * Join the room for today's seed. Everyone in it is flying the same level,
   * so all anyone needs from anyone else is a position. There is no shared
   * world state to agree on, which is the whole reason this is affordable.
   */
  private connectLive(): void {
    const mission = this.mission;
    if (!mission || !apiConfigured()) return;
    if (this.live) return;

    this.live = new LiveLink(mission.seed, this.pilot, pilotName(this.pilot), {
      onJoin: (peerId, name) => this.squad.addLive(peerId, name),
      onLeave: (peerId) => this.squad.remove(peerId),
      onPose: (peerId, frame) => {
        // A pose can arrive before the join for it, depending on ordering.
        if (!this.squad.has(peerId)) this.squad.addLive(peerId, 'Pilot');
        this.squad.pushLive(peerId, frame);
      },
      onFull: () => {
        // Nothing to say. The squad is already full of ghosts and the run is
        // identical either way.
      },
    });
    this.live.connect();
  }

  private async endRun(): Promise<void> {
    const run = this.run;
    if (!run) return;

    this.ui.className = '';

    this.screen = 'results';
    this.input.reset();
    audio.play(run.phase === 'extracted' ? 'extract' : 'down');
    music.duck();
    music.playSting();

    // Judged here, once, off the finished run. The stage owns the rule; this
    // only asks it. See src/data/campaign.ts.
    const progress = stageProgressOf(run, PLAYER_MAX_HEALTH);
    this.stageCleared = run.stage.clear(progress);

    /*
     * Banked here, before a single network call.
     *
     * The stage has been judged beaten by the rule the stage itself owns. That
     * is the whole basis for opening the next one, and nothing that happens to
     * a leaderboard afterwards can make it less true.
     */
    if (this.stageCleared && !this.practice) writeCleared(run.stage.n);

    this.contractsMet = metContracts(this.contracts, progress);
    // Contracts pay on top of the market and the stage. Applied to the run so
    // the number on the results screen is the number that gets posted.
    run.contractBonus = contractBonus(this.contracts, progress);

    const data = cardDataFrom(run, null);
    this.cardUrl = drawScoreCard(data);
    void this.prepareCardFile(run.mission.date);

    // Paint the results immediately, then fill in rank and challenge state as
    // the network answers. A good run should never wait on a leaderboard.
    this.showResults();

    /*
     * A practice run leaves no trace anywhere.
     *
     * The gate promises "nothing is saved" before the run rather than after,
     * so this is the line that has to make it true. Every persistence path is
     * skipped here at the one place they all pass through, rather than each
     * being taught about practice separately: a new path added later is then
     * off by default instead of quietly saving.
     */
    if (this.practice) {
      this.showResults();
      return;
    }

    await this.submitScore(run);
    await this.submitGhost(run);
    if (this.challenge) await this.resolveChallenge(run);
    this.showResults();
  }

  /**
   * Upload the recording so the next player flies beside this run.
   *
   * Only runs worth flying next to. A recording of somebody who crashed into
   * the first hill teaches nobody anything and takes a squad slot from a run
   * that would.
   */
  private async submitGhost(run: RunState): Promise<void> {
    if (!apiConfigured()) return;
    if (this.recorder.length < 40) return;
    if (run.score <= 0) return;

    await postGhost({
      deviceId: this.pilot,
      name: this.displayName(),
      seed: run.mission.seed,
      score: run.score,
      facesExtracted: run.facesExtracted,
      trace: this.recorder.encode(),
    });

    // Refresh the pool so the next run reflects who else has posted since.
    void this.loadGhosts();
  }

  private showResults(): void {
    // The run is over. Whatever was banked describes a stage that has already
    // been scored, and coming back to it would replay a run twice.
    clearSnapshot();
    const run = this.run;
    if (!run) return;

    if (this.challenge) {
      this.showChallengeScreen();
      return;
    }

    /*
     * A preview never shows a score.
     *
     * Deliberately not a smaller results screen. A number settles the question,
     * and the point of a preview is to leave it open: they have seen today's
     * real chart and the people in it, and what the run was worth is on the
     * other side of opening it properly.
     */
    /*
     * Clearing the last stage ends the campaign, not the run.
     *
     * Shown before the results card, because the results card is a score and
     * this is the point of the whole thing. The score is still there behind it.
     */
    if (
      run.stage.n === STAGES.length &&
      run.phase === 'extracted' &&
      !run.practice &&
      !this.endingShown
    ) {
      // Once per clear. Without the latch, dismissing it would land back here
      // and show it again, which is a loop with no way out.
      this.endingShown = true;
      this.ui.className = '';
      this.screen = 'results';
      renderEnding(this.ui, {
        state: run,
        onContinue: () => this.showResults(),
      });
      return;
    }

    if (run.preview) {
      this.ui.className = '';
      this.screen = 'results';
      renderHandoff(this.ui, {
        state: run,
        onReplay: () => this.startRun(),
        onHome: () => this.showBrief(),
      });
      return;
    }

    this.ui.className = '';

    this.screen = 'results';
    renderResults(this.ui, {
      state: run,
      cardUrl: this.cardUrl,
      postError: this.postError,
      rank: this.rank,
      profile: this.profile,
      rankedUp: this.rankedUp,
      unlockedWeapon: this.unlockedWeapon,
      stageCleared: this.stageCleared,
      contracts: this.contracts,
      contractsMet: this.contractsMet,
      // Only when this run actually opened something new. Offering "next" for a
      // stage they had already cleared would be a promotion to nowhere.
      nextStage:
        this.stageCleared && run.stage.n === this.cleared() && run.stage.n < STAGES.length
          ? stageAt(run.stage.n + 1)
          : null,
      onNextStage: () => {
        this.stage = Math.min(STAGES.length, run.stage.n + 1);
        writeStage(this.stage);
        this.startRun();
      },
      onLoadout: () => this.showLoadout(),
      onCampaign: () => this.showCampaign(),
      onHome: () => this.showBrief(),
      onReplay: () => this.startRun(),
      onChallenge: () => void this.createChallenge(),
      onShare: () => void this.share(),
      onBoard: () => void this.showBoard(),
      practice: this.practice,
      needsWallet: this.needsWallet,
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,
    });
  }

  private async showBoard(tab: BoardTab = this.boardTab): Promise<void> {
    const mission = this.mission;
    if (!mission) return;

    // A new tab is a new list, so page one of it.
    if (tab !== this.boardTab) this.boardPage = 0;
    this.boardTab = tab;
    this.ui.className = '';
    this.screen = 'board';

    // Paint the frame immediately with a loading body, so switching tabs is
    // instant and the fetch fills in underneath rather than blanking the page.
    const paint = (entries: BoardEntry[], offline: boolean, loading: boolean): void => {
      if (this.screen !== 'board') return;
      renderBoard(this.ui, {
        mission,
        tab: this.boardTab,
        entries,
        meId: this.pilot,
        offline,
        loading,
        page: this.boardPage,
        onPage: (next) => {
          this.boardPage = Math.max(0, next);
          paint(entries, offline, loading);
        },
        onTab: (next) => void this.showBoard(next),
        onBack: () => (this.run?.finished ? this.showResults() : this.showBrief()),
      });
    };

    paint([], false, true);

    if (!apiConfigured()) {
      paint([], true, false);
      return;
    }

    const result = tab === 'daily' ? await fetchBoard(mission.date) : await fetchAllTime();

    // A tab switched while this was in flight must not be overwritten by the
    // answer to the question the player already moved on from.
    if (this.boardTab !== tab) return;

    paint(result.ok ? result.value : [], !result.ok, false);
  }

  // Scores and challenges --------------------------------------------------

  /**
   * Post the score, if we have a device to key it to and a service to post to.
   *
   * The device identifier is only requested after a finished run, never at
   * boot. Asking someone to approve an identifier before they have played is
   * how you lose them on the first screen.
   */
  private async submitScore(run: RunState): Promise<void> {
    if (!apiConfigured()) return;

    // Ask for the stronger identity exactly once, and only after a finished
    // run, which is the first moment the player gets anything for it. If they
    // decline, or we are not inside Nimiq Pay, the local one carries on.
    if (!this.askedForDeviceId && this.session?.available) {
      this.askedForDeviceId = true;
      const deviceId = await askDeviceId();
      if (deviceId && upgradeTo(deviceId)) this.pilot = deviceId;
    }

    /*
     * Ask the wallet to sign the claim, when there is a wallet to ask.
     *
     * After the run and before the post, so the player is signing a number
     * they can already see rather than authorising something abstract. A
     * refusal costs nothing: the run posts unsigned, exactly as it always did
     * in a browser.
     */
    let claim: { publicKey: string; signature: string } | null = null;
    if (this.session?.available && !this.practice) {
      claim = await signClaim(
        `sface:${run.mission.date}:${run.mission.seed}:s${run.stage.n}:${run.score}`,
      );
    }

    // Captured before the post, so a tier crossed by this run can be detected
    // by comparing against where the pilot stood a moment ago.
    const faceBefore = this.profile?.lifetimeFace ?? 0;
    const before = rankFor(faceBefore).rank.tier;
    const rackBefore = unlockedWeapons(faceBefore).length;

    const result = await postScore({
      deviceId: this.pilot,
      name: this.displayName(),
      avatarUrl: this.me?.avatarUrl ?? null,
      cachesTaken: run.cachesTaken,
      relicTaken: run.relicTaken,
      extracted: run.phase === 'extracted',
      date: run.mission.date,
      seed: run.mission.seed,
      score: run.score,
      facesExtracted: run.facesExtracted,
      attackersCleared: run.attackersCleared,
      duration: run.time,
      stage: run.stage.n,
      stageCleared: this.stageCleared,
      // Spread rather than two optional fields, so a null claim sends nothing
      // at all instead of two undefined keys the schema would have to tolerate.
      ...(claim ?? {}),
    });

    if (result.ok) {
      this.rank = result.value.rank;

      // The server returns the updated record alongside the rank, so the
      // strip on the results screen is the real total rather than a local
      // guess that could drift from what the board says.
      const updated = parseProfile(result.value.profile);
      if (updated) {
        this.profile = updated;
        cacheProfile(updated);

        const after = rankFor(updated.lifetimeFace);
        this.rankedUp = after.rank.tier > before ? after.rank.name : null;

        // A gun that opens quietly is a gun nobody ever equips. Name it on the
        // one screen the player is already reading.
        const rack = unlockedWeapons(updated.lifetimeFace);
        this.unlockedWeapon =
          rack.length > rackBefore ? (rack[rack.length - 1]?.name ?? null) : null;
      }

      this.cardUrl = drawScoreCard(cardDataFrom(run, this.rank));
      void this.prepareCardFile(run.mission.date);
      this.postError = null;
    } else {
      /*
       * The reason, not a shrug.
       *
       * This used to show one sentence for every failure, so "the service is
       * unreachable" and "the service refused this score" were indistinguishable
       * from the outside. They call for completely different responses: one is
       * wait and try later, the other is a bug worth reporting. The reason was
       * there in the result the whole time and was being thrown away.
       */
      this.postError = `${t('errorBoardPost')} ${result.error}`;
    }
  }

  private async createChallenge(): Promise<void> {
    const run = this.run;
    if (!run) return;

    if (!apiConfigured()) {
      this.postError = 'Challenges need the service. Playing solo for now.';
      this.needsWallet = false;
      this.showResults();
      return;
    }

    // A challenge needs a wallet address to pay to, and that is the one thing
    // an identifier cannot stand in for. Say so before creating a dead bet.
    if (!this.session?.address) {
      this.postError = t('challengeNoWallet');
      this.needsWallet = true;
      this.showResults();
      return;
    }

    const result = await createChallenge({
      deviceId: this.pilot,
      name: this.displayName(),
      address: this.session?.address ?? null,
      date: run.mission.date,
      seed: run.mission.seed,
      stakeNim: DEFAULT_STAKE_NIM,
      score: run.score,
    });

    if (!result.ok) {
      this.postError = result.error;
      this.showResults();
      return;
    }

    this.challenge = result.value;
    this.challengeNotice = null;
    this.showChallengeScreen();
  }

  /** Opened from a deeplink. Show the terms before the run, not after. */
  private async openChallenge(id: string): Promise<void> {
    this.ui.className = '';
    this.screen = 'challenge';

    const result = await fetchChallenge(id);
    if (!result.ok) {
      this.challengeNotice = result.error;
      this.showBrief();
      return;
    }

    this.challenge = result.value;
    this.showChallengeScreen();
  }

  /** Report our score against an open challenge and find out who won. */
  private async resolveChallenge(run: RunState): Promise<void> {
    const challenge = this.challenge;
    if (!challenge || !this.pilot) return;
    if (challenge.creatorId === this.pilot) return;
    if (challenge.status !== 'open') return;

    // Never report a score against a level we did not actually play. The UI
    // already refuses to offer the run, but this is the call that settles
    // money, so it checks for itself rather than trusting a screen.
    if (challenge.seed !== run.mission.seed) {
      this.challengeNotice = 'That challenge was set on a different mission.';
      return;
    }

    const result = await acceptChallenge(challenge.id, {
      deviceId: this.pilot,
      name: this.displayName(),
      address: this.session?.address ?? null,
      score: run.score,
      seed: run.mission.seed,
    });

    if (result.ok) this.challenge = result.value;
    else this.challengeNotice = result.error;
  }

  private showChallengeScreen(): void {
    const challenge = this.challenge;
    const mission = this.mission;
    if (!challenge || !mission) return;

    /*
     * A challenge is a bet on a specific seed, and the level is generated from
     * it. If the challenge was set on a seed that is not the one today's
     * mission carries, playing it would produce a different level from the one
     * the creator played, and the bet would settle on two different games.
     *
     * The terrain lives in the mission payload and is not stored on the
     * challenge, so a past mission cannot be reconstructed. Refusing is the
     * only honest option, and it is far better than silently playing the wrong
     * level.
     */
    const seedMatches = challenge.seed === mission.seed;

    this.ui.className = '';

    this.screen = 'challenge';
    renderChallenge(this.ui, {
      challenge,
      mission,
      seedMatches,
      meId: this.pilot,
      walletAvailable: this.session?.available ?? false,
      notice: this.challengeNotice,
      settling: this.settling,
      lastScore: this.run?.finished ? this.run.score : null,
      onPlay: () => this.startRun(),
      onSettle: () => void this.settleChallenge(),
      onShare: () => void this.shareChallenge(),
      onDismiss: () => {
        this.challenge = null;
        this.challengeNotice = null;
        this.showBrief();
      },
    });
  }

  /**
   * Pay the stake. The loser pays the winner directly and the app never holds
   * a thing, so all this does is ask the host to send and then record what
   * came back.
   */
  private async settleChallenge(): Promise<void> {
    const challenge = this.challenge;
    if (!challenge || this.settling || !this.pilot) return;

    const winnerAddress = winnerAddressOf(challenge, this.pilot);
    if (!winnerAddress) {
      this.challengeNotice = 'The winner has no address to pay to.';
      this.showChallengeScreen();
      return;
    }

    this.settling = true;
    this.challengeNotice = null;
    this.showChallengeScreen();

    const result = await settle({
      recipient: winnerAddress,
      amountNim: challenge.stakeNim,
      memo: `sFace ${challenge.date} ${challenge.id.slice(0, 8)}`,
    });

    this.settling = false;

    if (!result.ok) {
      this.challengeNotice = result.reason;
      this.showChallengeScreen();
      return;
    }

    const recorded = await reportSettlement(challenge.id, {
      deviceId: this.pilot,
      serializedTx: result.serializedTx,
    });

    if (recorded.ok) {
      this.challenge = recorded.value;
    } else {
      // The chain has it even if our service does not. Say exactly that.
      this.challengeNotice =
        'Paid on chain, but the service did not record it. Your transaction is fine.';
    }

    this.showChallengeScreen();
  }

  /** Convert the drawn card off the click path, so Share never has to wait. */
  private async prepareCardFile(date: string): Promise<void> {
    this.cardShareFile = await cardFile(this.cardUrl, date);
  }

  private async share(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const data = cardDataFrom(run, this.rank);
    await shareRun(data, this.cardShareFile, window.location.origin);
  }

  private async shareChallenge(): Promise<void> {
    const challenge = this.challenge;
    if (!challenge) return;

    const link = challengeShareLink(challenge.id);

    // A challenge can be shared before this device has finished a run, in
    // which case there is no card and no score to put on one.
    const run = this.run;
    if (!run?.finished) {
      await shareLink(
        `${challenge.stakeNim} NIM says you cannot beat ${challenge.creatorScore.toLocaleString()} on ${challenge.date}'s wreck.`,
        link,
      );
      return;
    }

    await shareRun(cardDataFrom(run, this.rank), this.cardShareFile, link);
  }

  // Loop -------------------------------------------------------------------

  private update(dt: number): void {
    const run = this.run;
    if (!run) return;

    if (this.screen === 'run' && !run.finished && !this.paused && !this.briefing) {
      // Purchases resolve before the step, so a bomb bought this frame clears
      // the attacker that would otherwise have hit you during it.
      /*
       * At a node the four slots answer the question instead of buying.
       *
       * One set of inputs, two meanings, decided by where you are standing. The
       * alternative was four more keys and four more buttons on a phone screen
       * that is already carrying a stick, a trigger and a use key, for a verb
       * that only exists on one stage. The HUD swaps with it, so what the slots
       * do is always what is drawn under your thumb.
       */
      const reading = run.openNodeId !== null;
      const atGate = run.openGateId !== null;

      for (const slot of this.input.takeBuys()) {
        if (reading) {
          const outcome = answerNode(run, slot);
          if (outcome === 'captured') audio.play('relic');
          else if (outcome === 'wrong') audio.play('down');
          continue;
        }

        // The same four inputs answer the last stage's gates. One act, one set
        // of buttons, decided by what is in front of you.
        if (atGate) {
          const outcome = answerGate(run, slot);
          if (outcome === 'open') audio.play('relic');
          else if (outcome === 'wrong') audio.play('down');
          continue;
        }

        const item = CONSUMABLES[slot];
        if (!item) continue;
        const result = buy(run, item.id);
        if (result === 'broke') {
          run.emit({
            kind: 'lost',
            x: run.player.x,
            y: run.player.y,
            text: `${item.cost} ${run.purse.ticker}`,
          });
        } else if (result === 'nothing-to-open') {
          // Nothing was charged for. Say why, or a refused charge reads as a
          // dead key rather than as being in the wrong place.
          run.emit({
            kind: 'lost',
            x: run.player.x,
            y: run.player.y,
            text: 'No cell in reach',
          });
        } else if (result === 'bought') {
          audio.play('cache');
        }
      }

      /*
       * Is there anything to use, and therefore anything to draw and tap?
       *
       * Computed here rather than in the input layer or the renderer, because
       * this is the only place that can see both the run and the controls. Both
       * of those then read the one answer.
       */
      /*
       * Is there anything to use, and therefore anything to draw and tap?
       *
       * Two answers now: a car within reach on a city stage, or a gate in front
       * of you on the last one whose numbers you never went and got. Computed
       * here because this is the only place that can see both the run and the
       * controls, and both the input layer and the renderer read the one answer.
       */
      const atCar = Boolean(
        run.city &&
          run.car &&
          (run.driving
            ? carStopped(run)
            : Math.hypot(run.player.x - run.car.x, run.player.y - run.car.y) <= CAR_REACH),
      );

      const gate =
        run.openGateId === null
          ? null
          : (run.gates.find((g) => g.id === run.openGateId) ?? null);
      const canBuyRead = Boolean(
        gate &&
          gate.options.some((id) => {
            const ally = run.allies.find((a) => a.id === id);
            return ally !== undefined && !ally.known;
          }),
      );

      this.input.useVisible = atCar || canBuyRead;

      // Hand the use press to the simulation, which decides what it means.
      if (this.input.takeUse()) run.useRequested = true;

      const firedAt = run.player.lastFiredAt;
      step(run, dt, this.command());
      // One blip per round that actually left the gun. Playing it while the
      // trigger was merely held meant the sound ran at the frame rate and had
      // nothing to do with the weapon's fire rate.
      if (run.player.lastFiredAt !== firedAt) audio.play('shoot');
      this.watchDamage(run);
      // Record after the step, so a frame is the pose the player ended it in.
      this.recorder.sample(run);
      this.live?.publish(poseOf(run), performance.now());
    }

    if (run.city) {
      this.camera.followFree(run.player, run.city, dt);
    } else {
      this.camera.follow(run.player, run.terrain.groundAt(run.player.x), dt);
    }
    // Squadmates read the run clock, which is why a recording made yesterday
    // lines up with a run happening now without any synchronisation.
    this.squad.update(run.time, dt);
    // Sound before effects, because consuming the list empties it.
    this.playEvents(run);
    this.effects.consume(run.events, this.camera);
    this.effects.update(dt);

    if (this.screen === 'run' && run.finished) {
      void this.endRun();
    }
  }

  /**
   * Everything the run reported this step, as sound.
   *
   * Kills and rescues both emitted an event and neither made a noise, because
   * nothing was listening to the stream that already carried them. One loop
   * fixes both and every future event arrives audible by default.
   */
  private playEvents(run: RunState): void {
    for (const event of run.events) {
      const voice = voiceForEvent(event.kind);
      if (voice) audio.play(voice);
    }
  }

  /** Turn raw input into the command the simulation takes. */
  private command(): PlayerCommand {
    // Set only by the dev-only advance() helper, so an automated run can steer.
    if (this.commandOverride) return this.commandOverride;

    const aim = this.aimTarget();

    return {
      moveX: this.input.move.x,
      moveY: this.input.move.y,
      aimX: aim?.x ?? null,
      aimY: aim?.y ?? null,
      firing: this.input.firing,
    };
  }

  /**
   * Where the gun is pointing, in world coordinates.
   *
   * Three sources, in order of how explicit the player was being:
   *
   *   1. The right thumb, which reports a direction rather than a point.
   *   2. The mouse, which reports the point it is over.
   *   3. Failing both, the direction of flight.
   *
   * That third case is not a nicety. Fly with the keyboard and never touch the
   * mouse and there is no aim input at all, so the gun sits at its initial
   * heading and fires due right for the entire run, which is exactly as broken
   * as it sounds. Following the flight direction means the gun sweeps around
   * as you turn, and anyone who wants to aim independently still can.
   */
  private aimTarget(): { x: number; y: number } | null {
    const run = this.run;
    if (!run) return null;

    const REACH = 400;
    const player = run.player;

    const vector = this.input.aimVector;
    if (vector) {
      return { x: player.x + vector.x * REACH, y: player.y + vector.y * REACH };
    }

    if (this.input.aim) {
      return this.camera.screenToWorld(this.input.aim.x, this.input.aim.y);
    }

    // No explicit aim. player.ts falls back to the direction of flight, which
    // is a simulation rule and applies to every command source, so there is
    // nothing to compute here.
    return null;
  }

  /** Effects and audio react to health, which the run itself knows nothing about. */
  private watchDamage(run: RunState): void {
    if (run.player.health < this.lastHealth) {
      this.effects.damageFlash();
      this.camera.shake(9);
      // Going down is its own sound, at the moment it happens rather than a
      // beat later on the results screen.
      audio.play(run.player.health <= 0 ? 'down' : 'hit');
      if (run.player.health <= 0) this.camera.shake(22);
    }
    this.lastHealth = run.player.health;
  }

  private render(): void {
    const run = this.run;
    if (!run) return;

    this.renderer.draw(run, this.camera, this.effects, this.squad, {
      handle: this.me?.handle ?? null,
      avatarUrl: this.me?.avatarUrl ?? null,
    });

    if (this.screen === 'run') {
      this.hud.draw(
        this.renderer.context,
        run,
        this.input,
        this.renderer.width,
        this.renderer.height,
      );
    }
  }

  /**
   * Development helper. See the DEV block at the bottom of this file.
   *
   * `advance` exists because a browser throttles requestAnimationFrame to a
   * standstill in a background tab, which makes a ninety second run impossible
   * to drive from an automated test. It steps the real update path rather than
   * a parallel one, so anything it exercises is the code that actually ships.
   */
  debug(): {
    run: RunState | null;
    screen: Screen;
    squad: Squad;
    music: typeof music;
    advance: (seconds: number, command?: Partial<PlayerCommand>) => void;
  } {
    return {
      run: this.run,
      screen: this.screen,
      squad: this.squad,
      music,
      advance: (seconds, command) => {
        const steps = Math.min(Math.round(seconds * 60), 60 * 200);
        this.commandOverride = command
          ? { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false, ...command }
          : null;
        for (let i = 0; i < steps; i++) this.update(1 / 60);
        this.commandOverride = null;
      },
    };
  }

  private onResize = (): void => {
    this.renderer.resize();
    this.camera.resize(this.renderer.width, this.renderer.height);
    this.hud.measure();
  };
}

/** The player's current pose, in the shape squadmates are drawn from. */
function poseOf(run: RunState): GhostFrame {
  return {
    x: run.player.x,
    y: run.player.y,
    angle: Math.atan2(run.player.aimY, run.player.aimX),
    firing: run.player.fireCooldown > 0,
    down: run.phase === 'died',
    carrying: run.carrying,
  };
}

function winnerAddressOf(challenge: Challenge, meId: string): string | null {
  const creatorWon = (challenge.opponentScore ?? -1) < challenge.creatorScore;
  if (creatorWon) {
    return challenge.creatorId === meId ? null : challenge.creatorAddress;
  }
  return challenge.opponentId === meId ? null : challenge.opponentAddress;
}

const app = new App();

// Development only, and stripped from the production bundle by the constant
// folding on import.meta.env.DEV. Being able to jump the ship down the level
// or read the live run state is the difference between testing the last third
// of a ninety second level once a minute and testing it whenever you like.
if (import.meta.env.DEV) {
  (window as unknown as { sface: unknown }).sface = app;
}

void app.boot().catch((error) => {
  // Nothing below this line is recoverable, so say something honest rather
  // than leaving a black rectangle on screen.
  const ui = document.querySelector<HTMLElement>('#ui');
  if (ui) {
    ui.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'screen screen--center screen--bare';
    const heading = document.createElement('h1');
    heading.textContent = 'sFace could not start';
    const detail = document.createElement('p');
    detail.textContent = String(error instanceof Error ? error.message : error);
    wrap.append(heading, detail);
    ui.append(wrap);
  }
  console.error('[sface] boot failed', error);
});

export { utcDate };
