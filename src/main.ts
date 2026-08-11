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
import { takeInAppReload, setPractising } from './core/network';
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
  installInsteadOfFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './core/fullscreen';
import { cardDataFrom, cardFile, drawScoreCard, shareLink, shareRun } from './ui/share';
import {
  acceptChallenge,
  apiConfigured,
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
  anchorPostedScore,
  sendChat,
  editChat,
  reportTip,
  fetchTips,
  markTipsSeen,
  signPostedScore,
  reportSettlement,
  registerPlayerCredential,
  type BoardEntry,
  type Challenge,
  type ClanDetail,
  type ClanRow,
  type Signals,
} from './net/api';
import { initialiseIdentity, pilotId, pilotName, upgradeTo } from './net/identity';
import {
  cacheProfile,
  fetchProfile,
  localProfile,
  parse as parseProfile,
  type Profile,
  type UnsignedRun,
} from './net/profile';
import { rankFor } from './data/story';
import { unlockedWeapons } from './data/weapons';
import { contractsFor, contractBonus, metContracts, type Contract } from './data/contracts';
import {
  STAGES,
  progressOf as stageProgressOf,
  stageAfter,
  stageAt,
  stageCleared,
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
import {
  balanceNim,
  connect,
  probe,
  askDeviceId,
  hostLanguage,
  isTestnet,
  type WalletSession,
} from './nimiq/wallet';
import { settle } from './nimiq/payments';
import {
  challengeShareLink,
  clanShareLink,
  readChallengeId,
  readClanTag,
  rememberChallenge,
  rememberedChallenge,
} from './nimiq/deeplink';
import { capture, matches, restore } from './game/snapshot';
import { clearSnapshot, clearTourDone, countTourShow, readCleared, readRoomSeen, readSnapshot, readStage, readTourDone, writeCleared, writeRoomSeen, writeSnapshot, writeStage, writeTourDone } from './browser-state';
import { Tour, deviceFor } from './core/tour';
import { TourCard } from './ui/tour';
import { touchCapable, usingPads } from './core/scheme';
import { breachButtonAt } from './core/breachbutton';
import { cellInReach } from './game/cell';
import { buy } from './game/consume';
import { slotIntent } from './game/intent';
import { CONSUMABLES } from './data/consumables';
import { ANCHOR_ADDRESS, anchorRun, signClaim } from './nimiq/wallet';
import { scoreClaimMessage } from './data/score-claim';
import { poseOf, shortAddress, winnerAddressOf } from './ui/app-helpers';

function scoreClaimForRun(run: RunState): string {
  return scoreClaimMessage({ date: run.mission.date, seed: run.mission.seed, stage: run.stage.n, score: run.score });
}

import { renderSettings } from './ui/settings';
import { renderChat } from './ui/chat';
import type { ChatMessage, ChatPerson, TipRecord } from './net/api';
import type { TipTarget } from './ui/chat';
import { MAX_MESSAGE as CHAT_MAX } from './data/chat';
import { renderProfile } from './ui/profile';
import { trackViewport } from './core/viewport';
import {
  isAddressless,
  landingFor,
  pathFor,
  type Screen as RouteScreen,
} from './core/routes';
import { onNetworkChange } from './core/network';
import { renderContests, type ContestFilter } from './ui/contests';
import type { AppNotification } from './ui/notifications';
import { renderContestNew, type ContestDraft } from './ui/contest-new';
import { renderContest } from './ui/contest';
import { isExpired, remainingFor, stageRange, stagesLabel, type Contest } from './data/contests';
import {
  createContest,
  fetchChat,
  fetchContest,
  fetchContests,
  joinContest,
  reportContestPayment,
} from './net/api';
import { debtOf } from './data/contests';
import { CAR_REACH, carStopped } from './game/car';
import { answerNode } from './game/node';
import { answerGate } from './game/ally';

/*
 * The list itself lives in core/routes.ts, beside the addresses.
 *
 * Two copies of it is how a screen gets renamed on one side and quietly stops
 * being routable on the other.
 */
type Screen = RouteScreen;

/**
 * Floor on how long the loading screen is shown.
 *
 * Long enough to read the three checks it is reporting. A warm load resolves in
 * a few hundred milliseconds and without this the screen is a flicker.
 */
const MIN_LOADING_MS = 3200;

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
   * The first-play tour, while one is running.
   *
   * Null on every run after the first, which is the normal case. See
   * core/tour.ts for the steps and browser-state.ts for the rule that decides
   * whether a run gets one.
   */
  private tour: Tour | null = null;

  /**
   * The card the tour is drawn on.
   *
   * Made once and kept, rather than per run, because it has a Skip handler
   * bound to this app and rebuilding it per run would leak a listener a run.
   * It only appears on screen while `tour` is set.
   */
  private readonly tourCard = new TourCard({ onSkip: () => this.endTour(true) });

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
  /** True while the ending is on screen and must not be painted over. */
  private endingOpen = false;
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
  /**
   * How far the campaign had been taken when this run started.
   *
   * Captured at the start rather than read at the end, because clearing a stage
   * writes progress immediately: by the time the results screen asks whether
   * this was a first clear, the answer has already been overwritten by itself.
   */
  private clearedBefore = 0;
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

  /**
   * Whether the run just posted carries a wallet signature.
   *
   * Drives the button on the results screen. Null while nothing has been
   * posted, so a fresh session does not offer to sign a run that does not
   * exist.
   */
  private signedRun: boolean | null = null;
  private signingOldRun = false;
  private oldRunNotice: string | null = null;
  private signing = false;
  private signNotice: string | null = null;

  private challenge: Challenge | null = null;
  private pendingChallengeId: string | null = null;
  /** Clan requests waiting on this pilot to decide, when they own one. */
  private clanRequests = 0;
  /** A clan they asked for while already in one, awaiting confirmation. */
  private pendingJoin: string | null = null;
  private bellOpen = false;
  /** Notification ids the player has cleared, so they do not come back. */
  private dismissed = new Set<string>();

  // Contests ---------------------------------------------------------------
  private contests: Contest[] = [];
  private contestFilter: ContestFilter = 'all';
  private contestsLoading = false;
  private contestsOffline: string | null = null;
  private contestNotices: Record<string, string> = {};
  private joiningContest: string | null = null;
  private contestBusy = false;
  private contestNotice: string | null = null;
  /** The contest being looked at, and whether a payment is in flight. */
  private openContestPage: Contest | null = null;
  /**
   * True while the browser is driving, not us.
   *
   * A back button that opened a screen which then pushed its own history entry
   * would make going back push you forward again, and the button would appear
   * to do nothing at all.
   */
  private restoring = false;
  private payingContest = false;
  private payNotice: string | null = null;
  /**
   * The terms being drafted, kept on the app rather than in the screen.
   *
   * The screen is a pure render, so the draft has to outlive it: every tap on a
   * stepper repaints, and a draft owned by the screen would reset itself on the
   * first change anybody made.
   */
  private draft: ContestDraft = {
    kind: 'duel',
    from: 1,
    to: 1,
    stakeNim: 5,
    seats: 2,
    visibility: 'open',
    // The rest of the day, which is as long as today's level exists.
    openMinutes: null,
  };
  private challengeNotice: string | null = null;
  /** The room, held so a refresh does not blank it while it reloads. */
  private room: { messages: ChatMessage[]; people: Record<string, ChatPerson> } = {
    messages: [],
    people: {},
  };
  private roomLoading = false;
  private roomNotice: string | null = null;
  /**
   * Whether the notice on the room came from a failed load rather than an act.
   *
   * The room re-reads itself every few seconds, and a successful read used to
   * clear whatever was on screen. That is right for "the room could not be
   * reached" and wrong for "sent 5 NIM to somebody", which is the one sentence
   * in this app a player most needs to still be there a moment later.
   */
  private roomNoticeIsLoad = false;
  private roomSending = false;
  /** The day of a run of mine that can be posted, decided by the service. */
  private roomShareDate: string | null = null;
  /** The message being answered, if any. Cleared once it is sent. */
  private replyingTo: string | null = null;
  /** The message being changed, if any. Its text goes back in the box. */
  private editingId: string | null = null;
  /**
   * When this pilot last had the room open, as epoch milliseconds.
   *
   * Kept on the device rather than on the service. It exists to decide whether
   * a reply is news, which is a question about this screen having been looked
   * at, and a room that had already been read on a phone should not keep
   * announcing itself on a laptop.
   */
  private roomSeenAt = readRoomSeen();
  /**
   * Tips somebody sent or tried to send me, and who sent them.
   *
   * The only notification in the app that cannot be worked out on this device,
   * because it happened on somebody else's. See server/tips.ts.
   */
  private tipsWaiting: TipRecord[] = [];
  private tipPeople: Record<string, { name: string; avatarUrl: string | null }> = {};
  /** Cleared when the room screen is left, so it stops polling an empty page. */
  private roomTimer: number | null = null;
  /**
   * Whether the run just finished is the one on today's board.
   *
   * Reported by the service when the score is posted, because only it knows
   * which row survived: the board keeps the best run of the day.
   */
  private runIsOnBoard = false;
  /** Set while a wallet is being asked to send an anchor transaction. */
  private anchoring = false;
  private anchorNotice: string | null = null;
  /** The transaction hash once this run is on the chain. */
  private anchorHash: string | null = null;
  /**
   * True once a transaction has left the wallet for this run, recorded or not.
   *
   * Separate from the hash because the two can disagree: the send can succeed
   * while this service fails to write it down. When they do, the button must
   * go, or the player pays again for something they already have.
   */
  private anchorSent = false;
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

    /*
     * The back button.
     *
     * Registered here rather than lazily, because the first thing somebody can
     * do after a deep link opens is press back, and a listener that arrives
     * later would miss it.
     */
    window.addEventListener('popstate', this.onPopState);

    /*
     * Switching chain refetches rather than reloading the page.
     *
     * Everything the network decides is cached here: the mission, the profile,
     * the boards, the contests. The old answer was to throw the page away so
     * none of them could disagree, which worked and cost a white flash and a
     * rebuild of the whole app to change one chip.
     *
     * Repainting whatever screen is up rather than going home, because the
     * player was reading something when they tapped it and taking that away is
     * the thing the reload was already doing wrong.
     */
    onNetworkChange(() => void this.reloadForNetwork());
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
      this.applyResize();
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

    this.applyResize();
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

    /*
     * A link wins, then whatever was left open.
     *
     * The id is remembered locally because there is no route that lists a
     * pilot's challenges: the service can answer "what is challenge X" and
     * nothing else. Without this, closing the tab loses a staked challenge
     * until the other player sends the link again, which is the kind of thing
     * that makes somebody think their NIM is gone.
     */
    this.pendingChallengeId = readChallengeId() ?? rememberedChallenge();
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

    /*
     * And not when a link named a page.
     *
     * Somebody opening sface.site/docs has asked for the docs. Playing the
     * opening at them first is answering a different question, and it made a
     * shared link look broken: you follow it, get five beats of story, and land
     * on the front door instead of the page you were sent.
     *
     * The opening is for arriving at the game with no destination in mind. A
     * deep link is the opposite of that.
     */
    const followedLink = this.routedTarget() !== null;

    if (
      !introSeen() &&
      !this.pendingChallengeId &&
      !returningFromX &&
      !this.inAppReload &&
      !followedLink
    ) {
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

  /**
   * A path somebody can be sent to, rather than a screen they have to find.
   *
   * "Open the game, tap the footer, then How to play" is three instructions and
   * a hope. A link is a link. These are the two worth having: one for what the
   * game is, one for how to play it.
   *
   * Read once at boot and then cleared out of the address bar with replaceState,
   * so a refresh later does not drag somebody back to the docs when they are
   * halfway through a run.
   */
  /**
   * Which screen the address bar is asking for, or null for the front door.
   *
   * Read rather than acted on, so the boot sequence can ask the same question
   * the landing does. They have to agree: if boot does not know a link was
   * followed it plays the opening first, and somebody who clicked a link to the
   * docs sits through the whole pitch before arriving.
   */
  private routedTarget(): Screen | null {
    const landing = landingFor(window.location.pathname);
    /*
     * The brief is the front door, so an address naming it is not a route.
     *
     * Treating it as one would skip the opening titles for everybody, since
     * every cold load on the bare domain resolves to the brief.
     */
    if (!landing || landing.screen === 'brief') return null;
    return landing.screen;
  }

  private routeFromPath(): boolean {
    const target = this.routedTarget();

    if (!target) return false;

    /*
     * The path stays in the address bar.
     *
     * It used to be cleared straight away, which made the link uncopyable the
     * moment it worked and made a successful route look like a failed one: you
     * open /docs, the docs open, and the bar says the bare domain. A refresh
     * also reopened the site rather than the page the URL named.
     *
     * It is cleared when a run starts instead, so somebody who reads the docs,
     * plays, and then reloads gets their run back rather than the docs again.
     * See clearRoutedPath.
     */
    this.restoring = true;
    try {
      this.goTo(landingFor(window.location.pathname));
    } finally {
      this.restoring = false;
    }
    return true;
  }

  /**
   * Drop a reading page once the player has started flying.
   *
   * ## Why only these two
   *
   * It used to clear any path at all when a run began, back when the only two
   * paths were the docs and the controls. Now that every screen has an address
   * that would throw away where the player came from: start a run from the
   * campaign, finish it, press back, and you would land on the front page
   * rather than on the campaign you were working through.
   *
   * The original reason still holds for the two reading pages. Somebody opens
   * the docs, plays, and reloads hours later; the docs are not what they want
   * back, and unlike a game screen they are not part of a route anybody is
   * navigating.
   */
  private clearRoutedPath(): void {
    const landing = landingFor(window.location.pathname);
    if (!landing) return;
    if (landing.screen !== 'about' && landing.screen !== 'controls') return;

    try {
      window.history.replaceState(null, '', '/' + window.location.search);
    } catch {
      // A browser that will not rewrite the bar loses nothing that matters.
    }
  }

  private landing(): void {
    if (this.invitedTag && !this.profile?.clanTag) {
      this.openClan();
      return;
    }

    // A shared link wins over everything except a clan invite, because somebody
    // following one asked for that page specifically.
    if (this.routeFromPath()) return;

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
    // X changes the public name and picture, not the authenticated player key.
    // Legacy progress needs device or wallet proof and cannot be merged from a
    // public handle-derived id.
    await this.refreshProfile();
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
    /*
     * Tips ride along with the record.
     *
     * Not because they are related, but because this is the call that already
     * happens at boot, after a run, and on a network switch, which is every
     * moment the bell needs to be right. A timer of its own would be a second
     * schedule polling for something that arrives a few times a day.
     */
    void this.loadTips();
    /*
     * And the room, for the same reason.
     *
     * A reply is derived from the messages, so the bell cannot know about one
     * until the room has been read at least once. Without this it only ever
     * appeared after opening the room, which is the one place it is not needed.
     */
    void this.loadChat();

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
    /*
     * Speech has its own gesture rule, separate from the audio context.
     *
     * Unlocking one was treated as unlocking both, and it is not: on iOS and
     * mobile Chrome the first speak() outside a gesture is dropped silently, so
     * the opening played its full length with no voice.
     */
    narrator.prime();
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
        soundOn: music.on,
        onToggleSound: () => {
          const on = music.toggle();
          if (audio.on !== on) audio.toggle();
          narrator.setMuted(!on);
          // Repaint in place. Bouncing anywhere from a paused run would lose
          // the run, which is the opposite of what pausing is for.
          this.setPaused(true);
        },
        onQuit: () => {
          this.paused = false;
          this.ui.className = '';
          // Deliberate, unlike a refresh, so the run is genuinely abandoned.
          clearSnapshot();
          /*
           * And the tour goes with it, unsettled.
           *
           * Somebody who quit part way through has not been taught the
           * controls, so the next run offers them again. browser-state.ts caps
           * how often that can happen, which is what keeps "not finished" from
           * turning into a tutorial that will not go away.
           */
          this.endTour(false);
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
    // mount() replaced the layer's children, so the card has to be put back.
    // Cheap and idempotent; see TourCard.attach.
    if (this.tour) this.tourCard.attach(this.ui);
  }

  // The tour ----------------------------------------------------------------

  /**
   * Decide whether this run opens with the controls explained, and open one.
   *
   * The rule, in one place: a first run gets the tour, whether that first run
   * is a practice run or a real one. Practice is where a stranger meets this
   * game and so it is the natural home for it, but practice is optional and
   * always was, and somebody who goes straight to signing in must not end up
   * with a ship, a gun and no statement anywhere about which key does what.
   *
   * One flag serves both, which is what stops the two paths having to know
   * about each other. See browser-state.ts for why it is per device.
   */
  private startTour(): void {
    this.endTour(false);

    if (readTourDone()) return;
    // A preview is 25 seconds long. Six steps do not fit in it, and spending a
    // quarter of somebody's only look at the game on a tutorial is the wrong
    // trade: the preview exists to make them want the real run.
    if (this.run?.preview) return;

    countTourShow();
    this.tour = new Tour(deviceFor(touchCapable(), usingPads()));
    this.tourCard.attach(this.ui);
  }

  /**
   * Take the tour down.
   *
   * `settled` is the difference between finishing and being interrupted. A tour
   * that ran its course, or that the player skipped, is done with and does not
   * come back. One abandoned by quitting the run has taught nobody anything, so
   * it is left unsettled and runs again next time, up to the cap in
   * browser-state.ts that stops "unsettled" from meaning "forever".
   */
  private endTour(settled: boolean): void {
    if (this.tour === null) return;

    this.tour = null;
    this.tourCard.detach();
    // The one line the tour adds to the simulation, off again the instant the
    // card leaves. See RunState.tutored.
    if (this.run) this.run.tutored = false;

    if (settled) writeTourDone();
  }

  /**
   * Feed the machine one step of the run, and draw whatever it returns.
   *
   * Called from update() immediately after step(), which is the only place that
   * can see both the run and the input, the same reason the recorder and the
   * live publish are there.
   */
  private advanceTour(run: RunState, dt: number, fired: boolean, bought: boolean): void {
    const tour = this.tour;
    if (!tour) return;

    const command = this.command();
    const cheapest = CONSUMABLES.reduce(
      (least, item) => Math.min(least, item.cost),
      Number.POSITIVE_INFINITY,
    );

    tour.observe(dt, {
      moving: Math.hypot(command.moveX, command.moveY) > 0.15,
      fired,
      freed: run.events.some((event) => event.kind === 'freed'),
      bought,
      canAfford: run.purse.held >= cheapest,
      // Close enough that pointing at the pad is telling somebody where they
      // already are. Generous, because the step is informational either way.
      nearExtraction: run.player.x >= run.extractionX - 600,
      cellInReach: cellInReach(run) !== null,
      carInReach: Boolean(
        run.city &&
          run.car &&
          Math.hypot(run.player.x - run.car.x, run.player.y - run.car.y) <= CAR_REACH,
      ),
      driving: run.driving,
      panelOpen: run.openNodeId !== null,
      gateOpen: run.openGateId !== null,
    });

    const step = tour.current;
    if (!step) {
      this.endTour(true);
      return;
    }

    run.tutored = true;
    this.tourCard.show(step, tour.position, tour.length, {
      width: this.renderer.width,
      height: this.renderer.height,
      slotCount: CONSUMABLES.length,
    });
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

  /**
   * Notice the wallet at boot. Deliberately does not ask for an account.
   *
   * See nimiq/wallet.ts: listAccounts is what raises the approval dialog, and
   * raising it during boot meant the wallet appeared to connect itself before
   * the player had asked for anything.
   */
  private async probeWallet(): Promise<void> {
    const session = await probe();
    this.session = session;
    setLanguage(session.language);
    // Re-render whatever is up, since the language may have just changed.
    if (this.screen === 'brief') this.showBrief();
  }

  /**
   * Get an address, asking for one if we do not have it yet.
   *
   * Every path that needs to sign or spend goes through here rather than
   * reading `session.address` and finding it null. One prompt, at the moment it
   * is earned, and the provider caches the approval afterwards.
   */
  /**
   * The Connect wallet button on the front door.
   *
   * Nothing more than asking, plus repainting so the address appears where the
   * button was. Somebody who just approved something wants to see that it took.
   */
  private async connectWallet(): Promise<void> {
    await this.requireAddress();
    if (this.screen === 'brief') this.showBrief();
  }

  private async requireAddress(): Promise<string | null> {
    if (this.session?.address) return this.session.address;
    if (!this.session?.available) return null;

    this.session = await connect();
    setLanguage(this.session.language);

    if (this.screen === 'brief') this.showBrief();
    return this.session.address;
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
    const was = this.screenValue;
    this.screenValue = next;
    this.paintChrome();
    this.syncAddress(was, next);
  }

  /**
   * Put the screen in the address bar, so back goes back.
   *
   * ## Where this sits
   *
   * Every screen change in the app runs through this setter, which is the only
   * reason a router can be added without touching thirty call sites. Anything
   * that opens a screen some other way is invisible to the history, so there is
   * deliberately no other way.
   *
   * ## Push against replace
   *
   * A new screen pushes, which is what gives back somewhere to go. Repainting
   * the screen you are already on replaces, or every refresh of a live list
   * would stack another identical entry and back would appear to do nothing
   * several times before it worked.
   *
   * A screen with no address of its own leaves the bar alone rather than
   * clearing it. Starting a run should not wipe the contest you came from out
   * of the history; you want to come back to it when the run ends.
   */
  private syncAddress(was: Screen, next: Screen): void {
    // Set while the browser is the one driving. Pushing here would fight the
    // navigation that caused it and leave an entry back to where you just left.
    if (this.restoring) return;

    /*
     * A run gets a spare history entry rather than an address.
     *
     * ## The bug this exists for
     *
     * Back during a run is supposed to pause. That is handled in onPopState,
     * and it only works if popstate fires at all. If the run began on the app's
     * very first history entry there is nothing behind it, so back does not pop
     * within the document: it leaves the page, the document unloads, and no
     * handler anywhere gets a say. Three minutes of a run, gone to a gesture
     * people make without thinking.
     *
     * Pushing a duplicate of the current address on the way in guarantees
     * something to pop. The address itself does not change, so the run still
     * has no page of its own and the screen behind it is still where back
     * eventually leads.
     */
    if (next === 'run' && was !== 'run') {
      try {
        window.history.pushState(null, '', window.location.pathname + window.location.search);
      } catch {
        // Nothing to be done. Back will leave, as it did before any of this.
      }
      return;
    }

    if (isAddressless(next)) return;

    const path = pathFor(next, this.routeParam(next));
    if (!path) return;

    try {
      const here = window.location.pathname + window.location.search;
      const url = path + window.location.search;
      if (here === url) return;

      if (was === next) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    } catch {
      // A WebView that refuses history rewriting still plays the game. It just
      // does not get a back button, which is where this started.
    }
  }

  /** The id in the address for screens that name one thing. */
  private routeParam(screen: Screen): string | null {
    if (screen === 'contest') return this.openContestPage?.id ?? null;
    if (screen === 'challenge') return this.challenge?.id ?? null;
    return null;
  }

  /**
   * The browser went back or forward. Follow it.
   *
   * ## Why a run is handled first
   *
   * Back during a run used to leave the game. Inside a wallet's WebView back is
   * a system gesture people use without meaning much by it, and losing three
   * minutes of a run to one is the worst thing this router could do. So a run
   * treats it as a pause: the entry that was popped is pushed straight back, no
   * navigation happens, and the player is looking at the pause screen rather
   * than at whatever came before the run.
   *
   * ## Why an unknown address goes home rather than nowhere
   *
   * Popping past the first screen the app ever showed lands on an address it
   * has no screen for. Doing nothing leaves the player on a page the URL no
   * longer describes, which is the state that makes back feel broken.
   */
  private onPopState = (): void => {
    if (this.screenValue === 'run') {
      try {
        window.history.pushState(null, '', window.location.pathname + window.location.search);
      } catch {
        // Nothing to restore. The pause below is still the right answer.
      }
      this.setPaused(true);
      return;
    }

    const landing = landingFor(window.location.pathname);
    this.restoring = true;
    try {
      this.goTo(landing);
    } finally {
      this.restoring = false;
    }
  };

  /**
   * Open the screen an address names.
   *
   * Shared by the back button and by a cold load on a deep link, because they
   * are the same question: this URL, what is on it. Anything the app cannot
   * open from an address alone falls through to the front, which is every
   * screen that needs a run or a fetch behind it.
   */
  private goTo(landing: ReturnType<typeof landingFor>): void {
    if (!landing) {
      this.showBrief();
      return;
    }

    switch (landing.screen) {
      case 'campaign':
        this.showCampaign();
        return;
      case 'board':
        void this.showBoard('daily');
        return;
      case 'contests':
        void this.showContests();
        return;
      case 'contest-new':
        this.showContestNew();
        return;
      case 'contest':
        if (landing.param) void this.openContestById(landing.param);
        else void this.showContests();
        return;
      case 'challenge':
        if (landing.param) void this.openChallenge(landing.param);
        else this.showBrief();
        return;
      case 'profile':
        void this.showProfile();
        return;
      case 'clan':
        this.openClan();
        return;
      case 'dispatch':
        void this.cross(() => this.showDispatch());
        return;
      case 'signals':
        this.openSignals();
        return;
      case 'chat':
        this.openChat();
        return;
      case 'loadout':
        this.showLoadout();
        return;
      case 'settings':
        this.showSettings();
        return;
      case 'controls':
        this.showControls();
        return;
      case 'about':
        void this.showAbout();
        return;
      default:
        this.showBrief();
    }
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
      notifications: this.notifications(),
      bellOpen: this.bellOpen,
      onToggleBell: () => {
        this.bellOpen = !this.bellOpen;
        this.paintChrome();
      },
      onClearNotifications: () => {
        /*
         * Dismiss, never resolve.
         *
         * Clearing hides what is listed; it does not answer a clan request or
         * settle a contest. Those still exist on their own screens, which is
         * why this only records what has been seen.
         */
        this.dismissed = new Set(this.notifications().map((n) => n.id));

        /*
         * Tips are the exception, and have to be marked on the service.
         *
         * Everything else here is derived from state this device can see, so
         * dismissing locally is enough: the thing itself is still on its own
         * screen. A tip has no screen of its own and no local source, so a
         * dismissal that lived only in this tab would bring three days of them
         * back on the next reload.
         */
        if (this.tipsWaiting.length > 0) {
          this.tipsWaiting = [];
          this.tipPeople = {};
          void markTipsSeen(this.pilot);
        }

        this.paintChrome();
      },
    });
  }

  /**
   * What is waiting on this player, derived rather than stored.
   *
   * Every entry is computed from state the app already has, so there is no
   * separate list to fall out of step with the thing it is about: a clan
   * request that has been answered stops being a notification because the
   * request is gone, not because something remembered to remove it.
   *
   * Only things with somewhere to go. A bell that fills with items you cannot
   * act on teaches people to ignore the bell, and then the clan request goes
   * unanswered again with an extra feature in the way.
   */
  private notifications(): AppNotification[] {
    const out: AppNotification[] = [];

    if (this.clanRequests > 0) {
      out.push({
        id: `clan-requests:${this.clanRequests}`,
        kind: 'clan-request',
        text: `${this.clanRequests} pilot${this.clanRequests === 1 ? '' : 's'} asked to join ${this.profile?.clanTag ?? 'your clan'}.`,
        at: Date.now(),
        go: () => void this.cross(() => this.openClan()),
      });
    }

    const open = this.liveChallenge();
    if (open) {
      out.push({
        id: `challenge:${open.id}`,
        kind: 'contest-waiting',
        text: `A ${open.stakeNim} NIM challenge is still open.`,
        at: Date.now(),
        go: () => void this.openChallenge(open.id),
      });
    }

    for (const contest of this.contests) {
      if (contest.hostId !== this.pilot) continue;
      if (contest.entrants.length === 0) continue;

      out.push({
        id: `contest:${contest.id}:${contest.entrants.length}`,
        kind: contest.status === 'settled' ? 'contest-settled' : 'contest-joined',
        text:
          contest.status === 'settled'
            ? `Your ${contest.stakeNim} NIM contest has a result.`
            : `${contest.entrants.length} in your ${contest.stakeNim} NIM contest.`,
        at: Date.now(),
        go: () => void this.cross(() => this.showContests()),
      });
    }

    /*
     * Replies, worked out from the room rather than stored anywhere.
     *
     * The room holds every message of the last day, so "somebody answered me"
     * is a question this device can answer for itself: which messages point at
     * one of mine, and did any of them land since I last had the room open.
     * That is the same shape as every other entry here, and it means a reply
     * cannot go stale or be announced twice by two stores disagreeing.
     *
     * Grouped into one line. Five answers to a good message is one reason to
     * open the room, not five things waiting on you.
     */
    const replies = this.repliesToMe();
    if (replies.length > 0) {
      const only = replies.length === 1 ? replies[0]! : null;
      const from = only ? (this.room.people[only.pilotId]?.name ?? 'Somebody') : null;

      out.push({
        id: `replies:${replies.length}:${replies[replies.length - 1]!.id}`,
        kind: 'reply',
        text: only
          ? `${from} replied to you in the room.`
          : `${replies.length} replies to you in the room.`,
        at: replies[replies.length - 1]!.at,
        go: () => void this.cross(() => this.openChat()),
      });
    }

    /*
     * Tips, which are the one kind that came from somewhere else.
     *
     * Two different sentences, deliberately. A tip that was sent names who sent
     * it and points at the wallet, because the wallet is the receipt and this
     * service only ever heard a claim about one. A tip that could not be sent
     * names nobody: there is no way for the reader to check it, and naming
     * somebody who cannot pay them would be a taunt rather than information.
     */
    for (const tip of this.tipsWaiting) {
      const sent = tip.state === 'sent';
      const from = this.tipPeople[tip.from]?.name ?? 'Somebody';

      out.push({
        id: `tip:${tip.id}`,
        kind: sent ? 'tip-in' : 'tip-blocked',
        text: sent
          ? `${from} tipped you ${tip.nim} NIM. Check your wallet.`
          : `Somebody tried to tip you ${tip.nim} NIM. Connect a wallet in Nimiq Pay to receive tips.`,
        at: tip.at,
        // Somewhere to go, which is what earns a place on this list. A tip that
        // arrived opens the room; one that could not opens the wallet.
        go: sent
          ? () => void this.cross(() => this.openChat())
          : () => void this.cross(() => this.showSettings()),
      });
    }

    return out.filter((n) => !this.dismissed.has(n.id));
  }

  /**
   * Answers to something I said, since the last time I looked at the room.
   *
   * Mine is decided by the pilot id on the parent, which is the service's own
   * record of who said what. A message cannot claim to be answering me.
   */
  private repliesToMe(): ChatMessage[] {
    if (this.room.messages.length === 0) return [];

    const mine = new Set(
      this.room.messages.filter((m) => m.pilotId === this.pilot).map((m) => m.id),
    );
    if (mine.size === 0) return [];

    return this.room.messages.filter(
      (m) =>
        m.replyTo !== null &&
        mine.has(m.replyTo) &&
        // Not my own answers to myself, and nothing I have already seen.
        m.pilotId !== this.pilot &&
        m.at > this.roomSeenAt,
    );
  }

  /**
   * Refetch everything the chain decides, without losing the screen.
   *
   * The contests list and the open contest are dropped rather than refetched,
   * because a contest belongs to one chain and the one being looked at does not
   * exist on the other. Clearing them means the next visit reads the new chain
   * instead of showing rows from the old one until something happens to
   * refresh them.
   */
  private async reloadForNetwork(): Promise<void> {
    this.contests = [];
    this.openContestPage = null;
    this.clanTable = [];
    this.myClan = null;
    this.rank = null;

    this.paintChrome();

    const [{ mission, notice }] = await Promise.all([
      loadMission(),
      this.refreshProfile(),
    ]);

    this.mission = mission;
    this.notice = notice;
    this.prepareRun();

    // Repaint where they are. Anything not listed redraws on its own next visit.
    if (this.screen === 'settings') this.showSettings();
    else if (this.screen === 'brief') this.showBrief();
    else if (this.screen === 'profile') this.showProfile();
    else if (this.screen === 'contests') this.showContests();
    else this.paintChrome();
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
        /*
         * Practice is testnet, and saying so here is the whole rule.
         *
         * Nothing is at stake in a practice run and nobody has signed in, so a
         * score from one has no business on the board people are competing on.
         * Forcing the network rather than asking also removes a decision that
         * would only ever have one right answer.
         */
        this.practice = true;
        setPractising(true);
        void this.cross(() => this.showBrief());
      },
    });
    this.notice = null;
  }

  /**
   * The room.
   *
   * Painted first, fetched second, same split as the clan screen: a render that
   * starts its own fetch and then repaints is how that screen once ended up
   * looping against the service.
   */
  private openChat(): void {
    this.ui.className = '';
    this.screen = 'chat';
    /*
     * Opening it is reading it.
     *
     * The watermark moves now rather than when the messages arrive, so a reply
     * that lands while the room is open in front of somebody is not counted as
     * unread the next time the bell is drawn.
     */
    this.roomSeenAt = Date.now();
    writeRoomSeen(this.roomSeenAt);

    this.paintChat();
    void this.loadChat();
    // The room is where somebody is most likely to be when a tip lands, and
    // tipping back is the obvious next thing they do.
    void this.loadTips();
    this.startRoomPolling();
  }

  /**
   * Re-read the room while it is open, and only while it is open.
   *
   * A conversation nobody is looking at is not worth a request every few
   * seconds, and a timer that outlives its screen keeps one running for the
   * rest of the session. Cleared by every other screen through stopRoomPolling.
   */
  private startRoomPolling(): void {
    this.stopRoomPolling();
    this.roomTimer = window.setInterval(() => {
      if (this.screen !== 'chat') {
        this.stopRoomPolling();
        return;
      }
      void this.loadChat();
    }, 6_000);
  }

  private stopRoomPolling(): void {
    if (this.roomTimer === null) return;
    window.clearInterval(this.roomTimer);
    this.roomTimer = null;
  }

  /**
   * Say something on the room screen that a refresh will not wipe.
   *
   * Every notice raised by something the player did goes through here. The one
   * raised by a failed read does not, which is the whole distinction: that one
   * is allowed to disappear the moment the read works.
   */
  private setRoomNotice(text: string | null): void {
    this.roomNotice = text;
    this.roomNoticeIsLoad = false;
    this.paintChat();
  }

  private async loadChat(): Promise<void> {
    if (!apiConfigured()) {
      this.roomNotice = 'The room needs the service, which is not configured here.';
      this.roomNoticeIsLoad = true;
      this.paintChat();
      return;
    }

    this.roomLoading = this.room.messages.length === 0;
    const result = await fetchChat(this.pilot);
    this.roomLoading = false;

    if (!result.ok) {
      // Only complain when there is nothing to show. A failed refresh over a
      // room that is already on screen is not worth an error on top of it.
      if (this.room.messages.length === 0) {
        this.roomNotice = result.error;
        this.roomNoticeIsLoad = true;
      }
      this.paintChat();
      return;
    }

    this.room = result.value;
    this.roomShareDate = result.value.shareableRunDate;
    /*
     * The bell is drawn from this too, so it has to be redrawn here.
     *
     * A reply is worked out from the room rather than stored, which means the
     * only moment the app can learn about one is a read like this. Off the room
     * screen there is nothing else that would repaint the bar.
     */
    if (this.screen !== 'chat') this.paintChrome();
    // Only what this function put there. See roomNoticeIsLoad.
    if (this.roomNoticeIsLoad) {
      this.roomNotice = null;
      this.roomNoticeIsLoad = false;
    }
    if (this.screen === 'chat') this.paintChat();
  }

  private paintChat(): void {
    if (this.screen !== 'chat') return;

    renderChat(this.ui, {
      messages: this.room.messages,
      people: this.room.people,
      meId: this.pilot,
      loading: this.roomLoading,
      notice: this.roomNotice,
      sending: this.roomSending,
      maxLength: CHAT_MAX,
      ticker: this.mission?.ticker ?? null,
      today: this.mission?.date ?? '',
      // The only origin an invite in a message may point at. See findInvite.
      origin: typeof window === 'undefined' ? '' : window.location.origin,
      replyingTo: this.replyingTo,
      editingId: this.editingId,
      onReply: (messageId) => {
        this.replyingTo = messageId;
        // Answering and editing are the same box, so starting one puts the
        // other down rather than leaving two half-open jobs on one field.
        this.editingId = null;
        this.paintChat();
      },
      onEdit: (messageId) => {
        this.editingId = messageId;
        this.replyingTo = null;
        this.paintChat();
      },
      onSend: (text) => void this.sayInRoom(text),
      onTip: (target, nim) => void this.tip(target, nim),
      /*
       * Only a run the board actually holds.
       *
       * The service answers this in the same request that fetches the room,
       * because it is the only thing that knows: the board keeps the best run
       * of the day, so having flown today is not the same as having a row.
       */
      onShareRun: this.roomShareDate ? () => void this.shareRun() : null,
      /*
       * An invite goes to the screen it names, inside the app.
       *
       * Not a link out and not a new page: the room is a WebView inside a
       * wallet, and opening one would put the player in a browser they then
       * have to find their way back from.
       */
      onInvite: (invite) => {
        if (invite.kind === 'contest') void this.openContestById(invite.id);
        else void this.openChallenge(invite.id);
      },
      onClan: (tag) => {
        this.invitedTag = tag;
        void this.cross(() => this.openClan());
      },
      onBack: () => {
        this.stopRoomPolling();
        void this.cross(() => this.showBrief());
      },
    });
  }

  private async sayInRoom(text: string): Promise<void> {
    if (this.roomSending) return;

    // The same box does both. Which one it is doing is whichever job is open.
    if (this.editingId) {
      await this.saveEdit(this.editingId, text);
      return;
    }

    this.roomSending = true;
    this.setRoomNotice(null);

    const answering = this.replyingTo;
    /*
     * Cleared before the answer comes back, with the box.
     *
     * The bar is about what you are writing, and it stops being true the moment
     * the message goes. Leaving it up until the service replies means the next
     * thing typed silently answers the same line again.
     */
    this.replyingTo = null;

    const result = await sendChat({ deviceId: this.pilot, text, replyTo: answering });
    this.roomSending = false;

    if (!result.ok) {
      this.setRoomNotice(result.error);
      return;
    }

    // Re-read rather than appending locally, so what is on screen is what the
    // service actually kept.
    await this.loadChat();
  }

  /**
   * Save a change to something I said.
   *
   * The service decides whether it is mine and whether the window has closed,
   * so a refusal here is read out rather than guessed at. Nothing is changed on
   * screen until the room has been re-read: an edit that looked applied and was
   * not is worse than one that takes a moment.
   */
  private async saveEdit(id: string, text: string): Promise<void> {
    this.roomSending = true;
    this.setRoomNotice(null);

    const result = await editChat({ id, deviceId: this.pilot, text });
    this.roomSending = false;

    if (!result.ok) {
      this.setRoomNotice(result.error);
      return;
    }

    this.editingId = null;
    await this.loadChat();
  }

  /**
   * Post a run of mine into the room.
   *
   * Sends the day and nothing else. The service reads the score off the board
   * under my own id, so what everybody sees is the row being ranked rather than
   * a number this device claimed about itself.
   */
  private async shareRun(): Promise<void> {
    if (this.roomSending || !this.roomShareDate) return;

    this.roomSending = true;
    this.setRoomNotice(null);

    const result = await sendChat({
      deviceId: this.pilot,
      // No caption. The card is the message, and making somebody write a line
      // to go with it is how a share turns into a chore.
      text: '',
      runDate: this.roomShareDate,
    });
    this.roomSending = false;

    if (!result.ok) {
      this.setRoomNotice(result.error);
      return;
    }

    await this.loadChat();
  }

  /**
   * Post the run just flown, then go and look at it.
   *
   * Landing in the room afterwards is the point. A share that reports success
   * and leaves you on the results screen gives no reason to believe anything
   * happened, and the room is where the tip button is.
   */
  private async postRunToRoom(date: string): Promise<void> {
    const result = await sendChat({ deviceId: this.pilot, text: '', runDate: date });

    this.roomNotice = result.ok ? null : result.error;
    this.roomNoticeIsLoad = false;
    void this.cross(() => this.openChat());
  }

  /**
   * Send somebody NIM for a good run.
   *
   * ## Why the address is never taken from the room
   *
   * It comes from the sender's profile, and a profile only carries an address
   * this service derived from a signature. A tip is real money leaving a real
   * wallet, so the one thing that must not be possible is a message persuading
   * somebody to pay an address it supplied itself.
   *
   * ## The four ways this ends
   *
   * Sent. Refused because they have no wallet, which costs nothing and puts a
   * note on their bell. Refused by the wallet, usually for balance, which is
   * the wallet's answer rendered in tip words rather than the stake words this
   * used to borrow. And nowhere to send from, on a browser with no wallet at
   * all, which now explains itself instead of hiding the button.
   *
   * There is no balance check before any of this, and there cannot be: the SDK
   * has no balance read. The wallet is the thing that knows, so the wallet is
   * the thing that says no.
   */
  private async tip(target: TipTarget, nim: number): Promise<void> {
    this.setRoomNotice(null);

    /*
     * Your own wallet first, before anything is said about theirs.
     *
     * The order is the whole of it. Somebody with no wallet at all was being
     * told that the other pilot had not connected one, which is a true sentence
     * about the wrong person: it reads as their problem when it is yours, and
     * it sends you looking at somebody else's setup for a reason you could not
     * have paid anyone.
     *
     * It also closed a hole. The refusal below files a note on the other
     * pilot's bell, and firing that for a tipper who could never have sent
     * anything made it a notification anybody could put in front of anyone,
     * free, from a browser with no wallet in it at all.
     *
     * Availability is asked before the address, because asking for an address
     * is what raises the wallet's approval dialog, and there is no dialog worth
     * raising where there is no wallet to raise it.
     */
    if (!this.session?.available) {
      this.setRoomNotice('Open sFace in Nimiq Pay to send a tip.');
      return;
    }

    const from = await this.requireAddress();
    if (!from) {
      this.setRoomNotice('Connect your wallet to send a tip.');
      return;
    }

    /*
     * Nobody to pay.
     *
     * Nothing opens and nothing is spent. The attempt is still recorded, which
     * is the entire point of letting the button exist for somebody with no
     * wallet: they find out they are missing tips, which is the only thing that
     * makes connecting one feel worth doing.
     */
    if (!target.address) {
      this.setRoomNotice(
        `${target.name} has not connected a wallet yet. They have been told somebody tried.`,
      );
      void reportTip({ deviceId: this.pilot, to: target.pilotId, nim });
      return;
    }

    const result = await settle({
      recipient: target.address,
      amountNim: nim,
      memo: `sFace tip ${target.name}`.slice(0, 60),
    });

    if (!result.ok) {
      // The wallet's own refusal, in tip words. It used to arrive talking about
      // stakes, which is challenge wording on a screen with no challenge on it.
      this.setRoomNotice(
        result.reason.replace(
          'Not enough NIM to cover that stake.',
          `Not enough NIM for a ${nim} NIM tip.`,
        ),
      );
      return;
    }

    this.setRoomNotice(`Sent ${nim} NIM to ${target.name}.`);

    /*
     * Told after the fact, and only as a claim.
     *
     * The wallet hands back a hash and this app has no node to check it
     * against, so what the other pilot is told points at their wallet rather
     * than asserting the money is there. Not awaited: the tip has happened
     * whether or not the service hears about it, and a failed report must not
     * turn a successful payment into an error on screen.
     */
    void reportTip({
      deviceId: this.pilot,
      to: target.pilotId,
      nim,
      tx: result.serializedTx,
    });
  }

  /**
   * Tips waiting for me, from the service.
   *
   * The one thing the bell cannot derive locally. Read when the app has an
   * identity to ask about, and again whenever the room is opened, which is
   * where somebody is most likely to be looking when one lands.
   */
  private async loadTips(): Promise<void> {
    if (!apiConfigured()) return;

    const result = await fetchTips(this.pilot);
    if (!result.ok) return;

    this.tipsWaiting = result.value.tips;
    this.tipPeople = result.value.people;
    this.paintChrome();
  }

  private showSettings(): void {
    this.ui.className = '';
    this.screen = 'settings';
    renderSettings(this.ui, {
      onBack: () => void this.cross(() => this.showBrief()),
      // Re-render in place rather than bouncing home, so a player trying the
      // three schemes can feel the difference without losing the page.
      onChange: () => this.showSettings(),
      // Prefills the faucet field, so claiming inside the wallet is one tap.
      address: this.session?.address ?? null,
      soundOn: music.on,
      onToggleSound: () => {
        // One switch for everything audible: the bed, the sting, the blips
        // and the narrator. Two separate toggles would be a settings screen.
        const on = music.toggle();
        if (audio.on !== on) audio.toggle();
        narrator.setMuted(!on);
        this.showSettings();
      },
      fullscreen: isFullscreen(),
      onFullscreen: fullscreenAvailable() ? () => void toggleFullscreen() : null,
      canInstall: installInsteadOfFullscreen(),
      voiceState: narrator.engineState,
      onReplayIntro: () => this.playIntro(),
      onControls: () => this.showControls(),
      tourDone: readTourDone(),
      onReplayTour: () => {
        clearTourDone();
        // Repaint, so the row changes to say the tour is coming. Without it the
        // button reads as having done nothing.
        this.showSettings();
      },
    });
  }

  /**
   * Everything that is yours, behind one tile.
   *
   * The balance is read after the first paint rather than awaited before it. It
   * is one RPC round trip to a node that may not answer, and blocking the page
   * on it would make the slowest thing on the screen decide when the screen
   * appears. The card renders "reading" and fills itself in.
   */
  /**
   * Everything open to enter.
   *
   * Painted before the fetch answers, so the screen appears at once and fills
   * in. A list that waits on the network shows a blank page for as long as the
   * slowest thing on it takes.
   */
  private showContests(): void {
    this.ui.className = '';
    this.screen = 'contests';
    this.paintContests();
    void this.loadContests();
  }

  private paintContests(): void {
    if (this.screen !== 'contests') return;

    renderContests(this.ui, {
      contests: this.contests,
      loading: this.contestsLoading,
      offline: this.contestsOffline,
      filter: this.contestFilter,
      me: { id: this.pilot, clanTag: this.profile?.clanTag ?? null },
      notices: this.contestNotices,
      joining: this.joiningContest,
      onFilter: (next) => {
        this.contestFilter = next;
        this.paintContests();
      },
      onJoin: (contest) => void this.takeSeat(contest),
      onOpen: (contest) => void this.cross(() => this.showContest(contest)),
      onCreate: () => void this.cross(() => this.showContestNew()),
      onBack: () => void this.cross(() => this.showBrief()),
    });
  }

  private async loadContests(): Promise<void> {
    if (!apiConfigured()) {
      this.contestsOffline = 'Contests need the service, which is not configured here.';
      this.paintContests();
      return;
    }

    this.contestsLoading = true;
    this.contestsOffline = null;
    this.paintContests();

    const result = await fetchContests();
    this.contestsLoading = false;

    if (result.ok) {
      this.contests = result.value;
      this.contestsOffline = null;
    } else {
      this.contestsOffline = result.error;
    }

    this.paintContests();
  }

  private async takeSeat(contest: Contest): Promise<void> {
    if (this.joiningContest) return;

    this.joiningContest = contest.id;
    delete this.contestNotices[contest.id];
    this.paintContests();

    /*
     * A staked seat needs a wallet, so ask for one before taking it.
     *
     * Prompting here rather than letting the service refuse: the player has
     * just tapped Take a seat, so the reason for the dialog is obvious, and a
     * refusal they have to decode afterwards is a worse version of the same
     * conversation.
     */
    let address = this.session?.address ?? null;
    if (contest.stakeNim > 0 && !address) {
      address = await this.requireAddress();
      if (!address) {
        this.joiningContest = null;
        this.contestNotices[contest.id] = 'Connect a wallet to enter a staked contest.';
        this.paintContests();
        return;
      }
    }

    const result = await joinContest(contest.id, {
      deviceId: this.pilot,
      name: this.displayName(),
      avatarUrl: this.me?.avatarUrl ?? null,
      address,
    });

    this.joiningContest = null;

    if (result.ok) {
      // Replace in place rather than refetching the whole list, so the seat
      // count updates without the page blinking through a spinner.
      this.contests = this.contests.map((c) => (c.id === result.value.id ? result.value : c));
    } else {
      this.contestNotices[contest.id] = result.error;
    }

    this.paintContests();
  }

  /**
   * One contest, with its standings and its bill.
   *
   * Painted from what the list already has, then refreshed. A page that waits
   * on the network to show a table it could already draw is a blank screen for
   * no reason.
   */
  /**
   * A contest named by the address rather than picked off the list.
   *
   * Needed because a contest page can be arrived at cold: someone shares a
   * link, or presses back onto one after a run. The list is not loaded in
   * either case, so the page has to fetch the thing it is about. A failure
   * lands on the list, which is the honest answer to "that contest is not
   * there any more".
   */
  private async openContestById(id: string): Promise<void> {
    const result = await fetchContest(id);
    if (!result.ok) {
      this.contestNotice = result.error;
      void this.showContests();
      return;
    }
    this.showContest(result.value);
  }

  private showContest(contest: Contest): void {
    this.ui.className = '';
    // Before the screen, not after: setting the screen is what writes the
    // address, and the address is the contest's id.
    this.openContestPage = contest;
    this.screen = 'contest';
    this.payNotice = null;
    this.paintContest();

    void fetchContest(contest.id).then((result) => {
      if (!result.ok || this.screen !== 'contest') return;
      this.openContestPage = result.value;
      this.paintContest();
    });
  }

  private paintContest(): void {
    const contest = this.openContestPage;
    if (this.screen !== 'contest' || !contest) return;

    renderContest(this.ui, {
      contest,
      meId: this.pilot,
      paying: this.payingContest,
      notice: this.payNotice,
      onPay: () => void this.payContestDebt(),
      onShare: () => void this.shareContest(contest),
      ...this.contestRun(contest),
      onBack: () => void this.cross(() => this.showContests()),
    });
  }

  /**
   * The next stage this contest wants from you, and whether you can fly it.
   *
   * ## Why the contest does not need telling
   *
   * A score posts with its date, seed and stage, and the service folds it into
   * every contest that matches and lists the pilot. So flying the right stage on
   * the right day is the whole mechanism: there is no separate contest run mode
   * to enter or forget to leave.
   *
   * What this does is stop somebody being sent to fly a stage that will not
   * count. The campaign gates stages on progress, so a pilot who took a seat in
   * a contest over stage five with two cleared would otherwise be quietly
   * dropped to stage three by the unlock rule, fly it, and wonder why nothing
   * landed.
   */
  private contestRun(contest: Contest): {
    onRun: (() => void) | null;
    nextStage: number | null;
    lockedReason: string | null;
  } {
    const me = contest.entrants.find((e) => e.id === this.pilot);
    if (!me || contest.status === 'settled' || contest.status === 'void') {
      return { onRun: null, nextStage: null, lockedReason: null };
    }

    const next = remainingFor(contest, me)[0] ?? null;
    if (next === null) {
      return { onRun: null, nextStage: null, lockedReason: null };
    }

    /*
     * The clock, checked before anything else that could offer a run.
     *
     * The service refuses a score posted after the deadline, so a Run button on
     * an expired contest sends somebody to fly three minutes of a stage that
     * cannot count. The reason is said rather than the button quietly vanishing,
     * because a missing button reads as a bug and this is a rule.
     */
    if (isExpired(contest, Date.now())) {
      return {
        onRun: null,
        nextStage: next,
        lockedReason: 'The clock ran out on this contest, so a run would not count toward it.',
      };
    }

    // Today's mission only. A contest is pinned to one day's level and the
    // service holds one day, so yesterday's contest cannot be flown or checked.
    if (this.mission && this.mission.seed !== contest.seed) {
      return {
        onRun: null,
        nextStage: next,
        lockedReason: 'This contest was opened on a different day, so its level is gone.',
      };
    }

    if (!stageUnlocked(next, this.cleared())) {
      return {
        onRun: null,
        nextStage: next,
        lockedReason: `Stage ${next} is not open to you yet. Clear the campaign up to it and the contest is waiting.`,
      };
    }

    return {
      onRun: () => {
        this.stage = next;
        writeStage(next);
        this.startRun();
      },
      nextStage: next,
      lockedReason: null,
    };
  }

  /**
   * Pay what this run cost you.
   *
   * ## Why the app cannot do more than this
   *
   * There is no escrow. Nimiq has the contract type, and the Mini App wallet
   * will only sign ten methods, none of which creates one, so nothing could
   * have held the stake while the contest was flown. What is left is making the
   * promise specific and the payment easy: the exact amount, the exact address,
   * one approval in their own wallet.
   *
   * The service is told afterwards. If the chain took it and the service did
   * not hear, the payment is still real and the screen says so rather than
   * implying the money went nowhere.
   */
  private async payContestDebt(): Promise<void> {
    const contest = this.openContestPage;
    if (!contest || this.payingContest) return;

    const debt = debtOf(contest, this.pilot);
    if (!debt?.toAddress) {
      this.payNotice = 'There is nowhere to send it. They have no wallet attached.';
      this.paintContest();
      return;
    }

    this.payingContest = true;
    this.payNotice = null;
    this.paintContest();

    const result = await settle({
      recipient: debt.toAddress,
      amountNim: debt.nim,
      memo: `sFace ${contest.date} ${contest.id.slice(0, 8)}`,
    });

    this.payingContest = false;

    if (!result.ok) {
      this.payNotice = result.reason;
      this.paintContest();
      return;
    }

    const told = await reportContestPayment(contest.id, {
      deviceId: this.pilot,
      txHash: result.serializedTx,
    });

    if (told.ok) {
      this.openContestPage = told.value;
    } else {
      // The chain has it even if our service does not. Say exactly that.
      this.payNotice =
        'Paid on chain, but the service did not record it. Your transaction is fine.';
    }

    this.paintContest();
  }

  /** The link, so somebody can be invited into a private one. */
  /**
   * Hand the link over, by whatever the host actually supports.
   *
   * ## Three ways, because one is never enough
   *
   * The clipboard alone was the whole implementation and it did nothing inside
   * Nimiq Pay: `navigator.clipboard` needs a secure context and a permission
   * the WebView does not grant, so the write rejected, the catch printed the
   * URL, and from the outside the button looked dead.
   *
   * The share sheet is tried first because it is what somebody pressing Share
   * on a phone means: it hands the link to their messages rather than to a
   * clipboard they then have to paste from. Clipboard second, for a desktop
   * browser where there is no sheet. And the link itself last, on screen and
   * selectable, which always works and is never worse than nothing.
   */
  private async shareContest(contest: Contest): Promise<void> {
    const link = `${window.location.origin}/?contest=${encodeURIComponent(contest.id)}`;
    const stakes = contest.stakeNim > 0 ? `${contest.stakeNim} NIM` : 'nothing but pride';
    const text = `Take a seat in my sFace contest. ${stagesLabel(contest.stages)} for ${stakes}.`;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'sFace contest', text, url: link });
        this.payNotice = null;
        this.paintContest();
        return;
      } catch {
        /*
         * Dismissed, or the host refused. Not an error worth reporting: a
         * cancelled share sheet is somebody changing their mind, and the
         * fallbacks below still give them the link.
         */
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      this.payNotice = 'Link copied.';
    } catch {
      // Neither works. Show the link so it can at least be selected by hand.
      this.payNotice = link;
    }

    this.paintContest();
  }

  private showContestNew(): void {
    this.ui.className = '';
    this.screen = 'contest-new';
    this.paintContestNew();
  }

  private paintContestNew(): void {
    if (this.screen !== 'contest-new') return;

    renderContestNew(this.ui, {
      draft: this.draft,
      onChange: (next) => {
        this.draft = next;
        this.paintContestNew();
      },
      clanTag: this.profile?.clanTag ?? null,
      // The clan detail is only loaded once the clan screen has been opened, so
      // this is false until then. Refusing on the service is what actually
      // enforces it; this only decides whether to offer the row.
      ownsClan: this.myClan?.ownerId === this.pilot,
      stagesCleared: this.cleared(),
      busy: this.contestBusy,
      notice: this.contestNotice,
      onOpen: () => void this.openContest(),
      onBack: () => void this.cross(() => this.showProfile()),
    });
  }

  private async openContest(): Promise<void> {
    if (this.contestBusy) return;

    if (!apiConfigured()) {
      this.contestNotice = 'Contests need the service, which is not configured here.';
      this.paintContestNew();
      return;
    }

    this.contestBusy = true;
    this.contestNotice = null;
    this.paintContestNew();

    const result = await createContest({
      deviceId: this.pilot,
      name: this.displayName(),
      avatarUrl: this.me?.avatarUrl ?? null,
      // Where they are paid if they win. A staked contest is refused without
      // one, because a winner with no address is a debt nobody can settle.
      address: this.session?.address ?? null,
      kind: this.draft.kind,
      stages: stageRange(this.draft.from, this.draft.to),
      stakeNim: this.draft.stakeNim,
      seats: this.draft.seats,
      visibility: this.draft.visibility,
      openMinutes: this.draft.openMinutes,
    });

    this.contestBusy = false;

    if (!result.ok) {
      this.contestNotice = result.error;
      this.paintContestNew();
      return;
    }

    this.contests = [result.value, ...this.contests];
    void this.cross(() => this.showContests());
  }

  private showProfile(): void {
    this.ui.className = '';
    this.screen = 'profile';

    let balance: number | null | undefined = undefined;

    const paint = (): void => {
      // Guard against a late RPC answer painting over whatever the player
      // navigated to in the meantime.
      if (this.screen !== 'profile') return;

      renderProfile(this.ui, {
        profile: this.profile,
        me: this.meChip(),
        walletAddress: shortAddress(this.session?.address ?? null),
        balanceNim: balance,
        weaponName: this.weapon().name,
        clanTag: this.profile?.clanTag ?? null,
        clanPending: this.clanRequests,
        openChallenge: this.liveChallenge(),
        onLoadout: () => void this.cross(() => this.showLoadout()),
        onClan: this.needsName('Clans', () => void this.cross(() => this.openClan())),
        onSignals: this.needsName('CT Signals', () => void this.cross(() => this.openSignals())),
        onChallenge: () => {
          const open = this.liveChallenge();
          if (open) void this.openChallenge(open.id);
        },
        onChallengeFriend: this.needsName('Contests', () =>
          void this.cross(() => this.showContestNew()),
        ),
        /*
         * Offered only inside a wallet that could actually sign.
         *
         * In a plain browser there is nothing to sign with, so the card is
         * absent rather than a button that opens a dialog nobody can answer.
         */
        onSignRun: this.session?.available ? (run) => void this.signOldRun(run) : null,
        signingRun: this.signingOldRun,
        signNotice: this.oldRunNotice,
        onBack: () => void this.cross(() => this.showBrief()),
      });
    };

    paint();

    const address = this.session?.address ?? null;
    if (!address) {
      balance = null;
      paint();
      return;
    }

    void balanceNim(address).then((nim) => {
      balance = nim;
      paint();
    });
  }

  /**
   * Sign a run that reached the board without a signature.
   *
   * The same act as the button on the results screen, reached from the profile
   * instead, because the moment after a run is not the only time somebody
   * decides they want their name on it. The board records the level on every
   * row, so the message can be rebuilt from what the service already published
   * rather than from anything this session happens to remember.
   */
  private async signOldRun(run: UnsignedRun): Promise<void> {
    if (this.signingOldRun) return;

    this.signingOldRun = true;
    this.oldRunNotice = null;
    this.showProfile();

    try {
      const address = await this.requireAddress();
      if (!address) {
        this.oldRunNotice = 'The wallet did not hand over an account, so there was nothing to sign with.';
        return;
      }

      const claim = await signClaim(scoreClaimMessage(run));
      if (!claim) {
        this.oldRunNotice = 'The wallet did not sign. Your score is still on the board.';
        return;
      }

      const told = await signPostedScore({
        deviceId: this.pilot,
        date: run.date,
        seed: run.seed,
        stage: run.stage,
        score: run.score,
        publicKey: claim.publicKey,
        signature: claim.signature,
      });

      if (!told.ok) {
        this.oldRunNotice = told.error;
        return;
      }

      // Re-read rather than patching the local copy, so the card disappears
      // because the service agrees it is done rather than because we assumed.
      await this.refreshProfile();
      this.oldRunNotice = null;
    } finally {
      this.signingOldRun = false;
      this.showProfile();
    }
  }

  /** What the Profile tile says under its name. */
  private profileTileValue(): string {
    if (this.liveChallenge()) return 'challenge waiting';
    if (this.clanRequests > 0) {
      return `${this.clanRequests} clan request${this.clanRequests === 1 ? '' : 's'}`;
    }
    if (!this.profile || this.profile.runs === 0) return 'rank, clan, wallet';
    return rankFor(this.profile.lifetimeFace).rank.name;
  }

  /**
   * A challenge worth walking back into, or null.
   *
   * Only one that is still waiting on somebody. A settled challenge is history
   * and putting it on the tile would nag about a thing already done.
   */
  private liveChallenge(): { id: string; stakeNim: number } | null {
    const c = this.challenge;
    if (!c) return null;
    if (c.status === 'settled') return null;
    return { id: c.id, stakeNim: c.stakeNim };
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
      profileValue: this.profileTileValue(),
      profileAlert: this.openChallenge !== null,
      onProfile: () => void this.cross(() => this.showProfile()),
      contestsValue: this.contests.length
        ? `${this.contests.length} open`
        : 'head to head, clans',
      contestsAlert: this.contests.some((c) => c.hostId === this.pilot),
      onContests: this.needsName('Contests', () => void this.cross(() => this.showContests())),
      onRoom: () => void this.cross(() => this.openChat()),
      /*
       * How many people have spoken today, not how many messages.
       *
       * A count of lines rewards whoever talks most; a count of people answers
       * the question somebody opening this actually has, which is whether there
       * is anybody in there.
       */
      roomValue: (() => {
        const people = new Set(this.room.messages.map((m) => m.pilotId)).size;
        if (people === 0) return 'say hello';
        return `${people} ${people === 1 ? 'pilot' : 'pilots'} talking`;
      })(),
      stage: stageAt(this.activeStage()),
      stagesCleared: this.cleared(),
      contracts: this.todaysContracts(),
      // Deliberately NOT gated. The campaign is where a practice player picks
      // which stage to taste, so locking it would hide the reason to sign in.
      onCampaign: () => void this.cross(() => this.showCampaign()),
      onDispatch: () => void this.cross(() => this.showDispatch()),
      onAbout: () => void this.cross(() => this.showAbout()),
      onControls: () => this.showControls(),
      onSettings: () => void this.cross(() => this.showSettings()),
      onStart: () => this.startRun(),
      onBoard: this.needsName('The leaderboard', () => void this.showBoard()),
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,
      /*
       * Offered only inside the wallet, and only until it is connected.
       *
       * In a browser there is nothing to connect to, so the button would be a
       * promise nothing can keep. Once an address exists the button is replaced
       * by the address itself.
       */
      onConnectWallet:
        this.session?.available && !this.session.address
          ? () => void this.connectWallet()
          : null,
      walletAddress: shortAddress(this.session?.address ?? null),
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
      /*
       * Joining while already in a clan asks first.
       *
       * Leaving is immediate and the new clan has to agree, so there is a real
       * window where somebody is in neither. That is worth a sentence before
       * it happens rather than a surprise afterwards.
       */
      onJoin: (tag) => {
        const current = this.profile?.clanTag ?? null;
        if (current && current !== tag) {
          this.pendingJoin = tag;
          this.paintClan();
          return;
        }
        void this.setClan(tag);
      },
      pendingJoin: this.pendingJoin,
      onConfirmJoin: () => {
        const tag = this.pendingJoin;
        this.pendingJoin = null;
        if (tag) void this.setClan(tag);
      },
      onCancelJoin: () => {
        this.pendingJoin = null;
        this.paintClan();
      },
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
    /*
     * Only the owner's own queue counts.
     *
     * `pending` comes back on the detail for anybody who can see the clan, so
     * counting it unconditionally would badge the Profile tile of every member
     * with requests they have no power to answer.
     */
    this.clanRequests =
      mine?.ok && mine.value.ownerId === this.pilot ? mine.value.pending.length : 0;

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
    /*
     * And practice stops holding the network to testnet.
     *
     * Signing in is the moment a run starts counting, so the stored choice
     * takes over again, which is mainnet unless they have deliberately switched.
     * Leaving the override on would quietly keep a signed-in player off the
     * board they just earned the right to be on.
     */
    setPractising(false);
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
    // Before anything this run does can move it. See clearedBefore.
    this.clearedBefore = this.cleared();
    this.anchorHash = null;
    this.anchorNotice = null;
    this.anchorSent = false;
    this.endingShown = false;
    this.cardUrl = null;
    this.cardShareFile = null;
    this.postError = null;
    this.screen = 'run';
    this.paused = false;
    // Starting deliberately discards whatever was banked. There is only ever
    // one run to come back to and this is now it.
    clearSnapshot();
    // And drops /docs off the URL, so a refresh mid-run resumes the run.
    this.clearRoutedPath();
    // After prepareRun, which is what decides whether this is a preview, and
    // before the brief, so the card is already in the layer when the run begins.
    this.startTour();
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

    /*
     * A world with no ground line places the player itself and gets the free
     * camera. Cities and the ring finale both qualify; a chart run does not.
     *
     * This used to test `city`, which is false on the finale, so stage seven
     * kept the default chart spawn out in a corner of a world it had no idea
     * was 5,800 across.
     */
    const world = this.run.freeWorld;
    if (world) {
      this.run.player.x = world.startX;
      this.run.player.y = world.startY;
      this.camera.jumpToFree(this.run.player, world);
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

    /*
     * A run that reached its end has been through the tour, whatever step it
     * happened to be on.
     *
     * Settled rather than abandoned, because the alternative is a player who
     * flew a complete run being taught the controls again on their next one.
     * Getting to the results screen is proof enough that they worked out how to
     * fly, which is the only thing the tour was there to establish.
     */
    this.endTour(true);

    this.screen = 'results';
    this.input.reset();
    audio.play(run.phase === 'extracted' ? 'extract' : 'down');
    music.duck();
    music.playSting();

    // Judged here, once, off the finished run. The stage owns the rule; this
    // only asks it. See src/data/campaign.ts.
    const progress = stageProgressOf(run, PLAYER_MAX_HEALTH);
    this.stageCleared = stageCleared(run.stage, progress);

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
    /*
     * The ending owns the screen until somebody presses Done.
     *
     * Everything that lands after a run finishes calls back in here: the score
     * post, the ghost upload, a challenge resolving. Each one used to repaint
     * over the ending.
     */
    if (this.endingOpen) return;

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
    /*
     * Cleared, not merely survived.
     *
     * This tested `phase === 'extracted'`, which only means the pad was
     * reached. Stage seven asks for five people out, the relic and eight
     * caches, so a run could land on the pad three short and still be handed
     * the ending: the market figures, the voice, the whole argument, for a
     * campaign that was not finished.
     *
     * It is the payoff for the last stage. Giving it to a run that did not
     * clear it costs the run that does.
     */
    if (
      run.stage.n === STAGES.length &&
      this.stageCleared &&
      !run.practice &&
      !this.endingShown
    ) {
      // Once per clear. Without the latch, dismissing it would land back here
      // and show it again, which is a loop with no way out.
      this.endingShown = true;
      /*
       * Held open until it is dismissed.
       *
       * endRun paints the results, posts the score, then paints them again with
       * the rank filled in. The second paint landed on top of the ending a
       * second or two after it appeared, so the whole sequence flashed past and
       * nobody got to read it. This flag is what makes showResults wait.
       */
      this.endingOpen = true;
      this.ui.className = '';
      this.screen = 'results';
      renderEnding(this.ui, {
        state: run,
        onContinue: () => {
          this.endingOpen = false;
          narrator.stop();
          this.showResults();
        },
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
      // The same reading the clear check ran on, so the screen lists exactly
      // what that check refused rather than a second opinion about the run.
      progress: stageProgressOf(run, PLAYER_MAX_HEALTH),
      contracts: this.contracts,
      contractsMet: this.contractsMet,
      /*
       * Clear a stage, get the next one. However many times you have cleared it.
       *
       * This used to also require the stage to be the furthest one reached,
       * on the reasoning that "next" for something already cleared is a
       * promotion to nowhere. That reads the button wrong. It is not a reward
       * for unlocking something, it is how you move through the campaign, and
       * gating it meant somebody who had finished all seven and started again
       * at stage one hit a wall at the end of every run: cleared, nothing to
       * press but Run it again, and no way forward without going back out to
       * the campaign screen.
       */
      nextStage: this.stageCleared ? stageAfter(run.stage.n) : null,
      onNextStage: () => {
        this.stage = Math.min(STAGES.length, run.stage.n + 1);
        writeStage(this.stage);
        this.startRun();
      },
      onLoadout: () => this.showLoadout(),
      onCampaign: () => this.showCampaign(),
      onHome: () => this.showBrief(),
      onReplay: () => this.startRun(),
      /*
       * Straight to the contest terms, not the old two-player challenge.
       *
       * There were two systems doing the same job. Challenge a friend opened
       * the original one, which is a single stage against one person and has
       * its own waiting screen, while Contests is the one that carries stage
       * ranges, seats, clans, standings and settlement. Somebody pressing this
       * after a run landed in the smaller one with no way across.
       *
       * The old flow still answers its own links, so a challenge already sent
       * keeps working. Nothing new is routed into it.
       */
      onChallenge: this.needsName('Contests', () =>
        void this.cross(() => this.showContestNew()),
      ),
      onShare: () => void this.share(),
      /*
       * Only for the run that is actually on the board.
       *
       * The room reads a card off that row, so a later and worse run has
       * nothing to post: the service would refuse it, correctly, after
       * somebody had already pressed a button that looked like it would work.
       */
      onPostToRoom:
        this.runIsOnBoard && !this.practice
          ? () => void this.postRunToRoom(run.mission.date)
          : null,
      onBoard: () => void this.showBoard(),
      practice: this.practice,
      needsWallet: this.needsWallet,
      onConnectX: this.xAvailable ? () => void this.doConnectX() : null,

      /*
       * Signing, offered rather than sprung.
       *
       * Only when the run actually landed on the board unsigned and there is a
       * wallet that could sign it. In a plain browser there is nothing to
       * offer, and on a signed run there is nothing left to do.
       */
      canSign:
        this.signedRun === false &&
        !this.practice &&
        (this.session?.available ?? false) &&
        (this.rank ?? 0) > 0,
      signing: this.signing,
      signNotice: this.signNotice,
      onSign: () => void this.signRun(run),

      /*
       * Offered on a run worth paying to remember, and not on the others.
       *
       * A fee prompt after every run reads as a toll, and most runs are not
       * worth one. A personal best or a stage cleared for the first time are
       * the two a player would actually want permanent, and both are things
       * the app already knows without asking anybody.
       */
      /*
       * Offered on every run that can be anchored, not only the good ones.
       *
       * It was gated on a personal best or a first clear, on the reasoning that
       * a fee prompt after every attempt reads as a toll. That reasoning was
       * fine and the result was not: on any other run the panel simply was not
       * there, which is indistinguishable from the feature being broken. It was
       * reported as never appearing at all, by somebody who had gone to the
       * trouble of buying NIM to try it.
       *
       * A control that comes and goes on a rule nobody can see is worse than one
       * that is always there and easy to ignore. The good runs are still marked
       * as good; that is now a line of text rather than a reason to hide it.
       */
      canAnchor:
        this.anchorHash === null &&
        // Never twice. See anchorSent.
        !this.anchorSent &&
        !this.practice &&
        ANCHOR_ADDRESS !== '' &&
        (this.session?.available ?? false) &&
        (this.rank ?? 0) > 0 &&
        /*
         * Only the run that is actually on the board.
         *
         * The board keeps the best run of the day and anchoring attaches to
         * that row, so a later and worse run has nothing to attach to. Offering
         * it anyway spent the fee first and found out afterwards, which is the
         * one failure a paid action must never have.
         */
        this.runIsOnBoard,
      anchorNotable: this.worthAnchoring(run),
      anchoring: this.anchoring,
      anchorNotice: this.anchorNotice,
      anchorHash: this.anchorHash,
      anchorSent: this.anchorSent,
      onAnchor: () => void this.anchorRun(run),
    });
  }

  /**
   * Sign a run that is already on the board.
   *
   * ## Why this is a button and not part of posting
   *
   * It used to happen during the post, which put a wallet dialog in front of
   * somebody in the two seconds they were reading their own score, and asked
   * for it whenever a wallet was merely present rather than connected, so
   * inside Nimiq Pay it failed every time.
   *
   * The score is already safe by the time this runs. Nothing here can lose it:
   * the board has always taken unsigned rows, and this only ever adds proof to
   * one that exists.
   *
   * Connecting first when there is no address yet, because that is the actual
   * reason the old version failed and making somebody find the button on
   * another screen to fix it would be a worse version of the same bug.
   */
  /**
   * Whether this run is one worth writing onto the chain.
   *
   * A personal best, or a stage cleared for the first time. Both are moments a
   * player would want permanent, and neither needs asking them: the profile
   * already carries their best score, and the campaign already knows how far
   * they had got before this run started.
   *
   * Deliberately not every run. Anchoring costs a network fee, and a button
   * asking for one after each attempt turns the results screen into a till.
   */
  private worthAnchoring(run: RunState): boolean {
    const best = this.profile?.bestScore ?? 0;
    if (run.score > best) return true;

    // Cleared a stage that was not open before this run.
    return this.stageCleared && run.stage.n > this.clearedBefore;
  }

  /**
   * Write a run onto the chain.
   *
   * ## Why the whole transaction goes to the service
   *
   * The wallet hands back the serialized transaction, and that is what is sent
   * on rather than the hash. A hash is a string: a service that accepted one
   * would be publishing a claim dressed as a receipt. The service parses this,
   * checks the signature, the recipient, the data and the chain, and computes
   * the hash itself. See server/anchor.ts.
   *
   * Nothing here can lose a score. The run is already on the board by the time
   * this can be pressed, and anchoring only adds a record to a row that exists.
   */
  private async anchorRun(run: RunState): Promise<void> {
    if (this.anchoring) return;

    this.anchoring = true;
    this.anchorNotice = null;
    this.showResults();

    try {
      const address = await this.requireAddress();
      if (!address) {
        this.anchorNotice =
          'The wallet did not hand over an account, so nothing was sent. Your score is still on the board.';
        return;
      }

      const data = scoreClaimForRun(run);
      const reply = await anchorRun(data);
      if (!reply) {
        this.anchorNotice = 'The wallet did not send it. Your score is still on the board.';
        return;
      }

      /*
       * From here the transaction has gone out, and nothing said afterwards may
       * suggest otherwise.
       *
       * The first version judged the wallet's reply in the client and returned
       * null for anything it did not recognise, so a successful send was
       * reported as "the wallet did not send it". That is not a wording problem.
       * It is false, it invites a retry, and every retry spends another fee on a
       * transaction that was already on its way. It cost real NIM before anybody
       * could see what was happening.
       */
      const told = await anchorPostedScore({
        deviceId: this.pilot,
        date: run.mission.date,
        seed: run.mission.seed,
        stage: run.stage.n,
        score: run.score,
        receipt: reply.receipt,
        shape: reply.shape,
      });

      if (!told.ok) {
        /*
         * Say what actually happened: sent, not recorded.
         *
         * And do not invite another attempt. The run is on the chain either
         * way; what failed is this service writing it down, and pressing the
         * button again buys a second transaction rather than a second chance.
         */
        this.anchorSent = true;
        /*
         * The reply's shape goes on screen, not only into a server log.
         *
         * What Nimiq Pay actually returns is the open question, and the answer
         * only exists on a device none of us can attach a console to. Putting it
         * in the notice means one attempt settles it from the phone that made
         * it, rather than needing someone to read a container log on a VPS.
         *
         * The shape only, never the value: it is a few characters describing a
         * type and a length, so nothing unexpected from a wallet ends up printed
         * on a screen.
         */
        this.anchorNotice = `Sent from your wallet, but sFace could not record it: ${told.error} The transaction is on the chain, so do not send it again. Wallet returned ${reply.shape}.`;
        return;
      }

      this.anchorHash = told.value.hash ?? null;
      this.anchorSent = true;
      this.anchorNotice = null;
    } finally {
      this.anchoring = false;
      this.showResults();
    }
  }

  private async signRun(run: RunState): Promise<void> {
    if (this.signing) return;

    this.signing = true;
    this.signNotice = null;
    this.showResults();

    try {
      // requireAddress is the one path that prompts, and it caches the
      // approval, so a player who has already connected sees no second dialog.
      const address = await this.requireAddress();
      if (!address) {
        this.signNotice =
          'The wallet did not hand over an account, so there was nothing to sign with. Your score is still on the board.';
        return;
      }

      const claim = await signClaim(scoreClaimForRun(run));
      if (!claim) {
        this.signNotice = 'The wallet did not sign. Your score is still on the board.';
        return;
      }

      const told = await signPostedScore({
        deviceId: this.pilot,
        date: run.mission.date,
        seed: run.mission.seed,
        stage: run.stage.n,
        score: run.score,
        publicKey: claim.publicKey,
        signature: claim.signature,
      });

      if (!told.ok) {
        this.signNotice = told.error;
        return;
      }

      this.signedRun = true;
      this.signNotice = null;
    } finally {
      this.signing = false;
      this.showResults();
    }
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
     * Sign only when an account has actually been approved.
     *
     * This used to test `available`, which is true inside Nimiq Pay whether or
     * not the player has ever connected. Since connecting became a deliberate
     * act rather than something boot did, that meant asking the wallet to sign
     * with no approved account: a dialog nobody asked for, arriving in the two
     * seconds somebody is reading their own score, and failing every time.
     *
     * So a connected wallet still signs here, silently and without a decision,
     * because the approval already happened. Everyone else posts unsigned and
     * is offered the button on the results screen. The score is never at risk
     * either way; the board has always taken unsigned rows.
     */
    let claim: { publicKey: string; signature: string } | null = null;
    if (this.session?.address && !this.practice) {
      claim = await signClaim(scoreClaimForRun(run));
    }
    this.signedRun = claim !== null;

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
      /*
       * Whether this run is the one the board kept.
       *
       * Only the service knows: it keeps the best run of the day, so a later
       * and worse one leaves the earlier row in place. Anchoring attaches to
       * that row, so this decides whether the offer can appear at all.
       *
       * An older service that does not send it leaves this false, which offers
       * nothing rather than offering something that would take a fee and fail.
       */
      this.runIsOnBoard = result.value.onBoard === true;

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


  /** Opened from a deeplink. Show the terms before the run, not after. */
  private async openChallenge(id: string): Promise<void> {
    this.ui.className = '';

    const result = await fetchChallenge(id);
    if (!result.ok) {
      this.challengeNotice = result.error;
      this.showBrief();
      return;
    }

    this.challenge = result.value;
    // After the fetch, so the address can name the challenge it landed on. Set
    // before the fetch, a failure would leave a URL pointing at nothing.
    this.screen = 'challenge';
    rememberChallenge(result.value);
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

    // Taking a bet needs somewhere to be paid, so ask before accepting rather
    // than discovering it is missing at settlement.
    const payTo = await this.requireAddress();

    const result = await acceptChallenge(challenge.id, {
      deviceId: this.pilot,
      name: this.displayName(),
      address: payTo,
      score: run.score,
      seed: run.mission.seed,
    });

    if (result.ok) {
      this.challenge = result.value;
      rememberChallenge(result.value);
    }
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
      onContests: () => void this.cross(() => this.showContests()),
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
      // Whether a number key did anything this step, for the tour's buy step.
      // Read from the outcomes below rather than from the keypress, so pressing
      // 3 with an empty purse does not count as having learned what 3 does.
      let bought = false;

      for (const slot of this.input.takeBuys()) {
        // What a number key means here. The rule lives in game/intent.ts so it
        // can be tested; it used to be inline and was wrong for a whole stage.
        const intent = slotIntent(run, slot);

        if (intent === 'answer-node') {
          const outcome = answerNode(run, slot);
          if (outcome === 'captured') audio.play('relic');
          else if (outcome === 'wrong') audio.play('down');
          bought = true;
          continue;
        }

        /*
         * A cell you are standing at outranks a gate you are merely near.
         *
         * On the ring city a gate counts as open for the whole band outside its
         * wall, which is most of the stage, and while it is open every number
         * key answers it. So standing at a cage that says PRESS 1 TO BLOW THE
         * DOOR and pressing 1 answered the gate instead, wrongly, and left the
         * cage shut. The game told the player to press a key that something
         * else had taken.
         *
         * Being in reach of a cell is a precise, local thing: you are next to
         * it. Being at a gate is a whole region. The precise one wins, and only
         * for the charge, so the other three still answer the wall.
         */
        if (intent === 'answer-gate') {
          const outcome = answerGate(run, slot);
          if (outcome === 'open') audio.play('relic');
          else if (outcome === 'wrong') audio.play('down');
          bought = true;
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
          bought = true;
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
      const fired = run.player.lastFiredAt !== firedAt;
      // One blip per round that actually left the gun. Playing it while the
      // trigger was merely held meant the sound ran at the frame rate and had
      // nothing to do with the weapon's fire rate.
      if (fired) audio.play('shoot');
      // Before the effects layer, which drains run.events, and before the
      // damage watcher, so a step that ends the tour drops the invulnerability
      // on the same frame rather than one late.
      this.advanceTour(run, dt, fired, bought);
      this.watchDamage(run);
      // Record after the step, so a frame is the pose the player ended it in.
      this.recorder.sample(run);
      this.live?.publish(poseOf(run), performance.now());
    }

    const world = run.freeWorld;
    if (world) {
      this.camera.followFree(run.player, world, dt);
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

    /*
     * Timed, so the renderer can trade sharpness for a playable frame rate.
     *
     * On the wallet's own viewport a step of the simulation costs about half a
     * millisecond and the picture costs nine to fifteen, so the picture IS the
     * frame budget, and a WebView rasterising canvas 2D in software is slower
     * again than anything a desktop can be throttled to. When it is losing, the
     * only lever worth pulling is how many pixels it is being asked to fill.
     *
     * Measured here rather than in the loop because this is the work being
     * judged. Timing the whole frame would fold in the simulation and whatever
     * else the browser had queued, and then quality would drop for reasons the
     * renderer cannot do anything about.
     */
    const startedAt = performance.now();

    this.renderer.draw(run, this.camera, this.effects, this.squad, {
      handle: this.me?.handle ?? null,
      avatarUrl: this.me?.avatarUrl ?? null,
    });

    if (this.screen === 'run') {
      /*
       * Tell the input layer where the gate card is, if one is up.
       *
       * Set from the run each frame rather than pushed when a gate opens, so a
       * gate that closes because the player moved away cannot leave a live hit
       * target behind on an empty screen.
       */
      /*
       * Only while the card is actually drawn.
       *
       * The HUD now hides it between arriving at a wall and reaching its gap,
       * and a hit target that outlives the thing it belongs to is worse than
       * none: a tap in clear air would answer a gate the player cannot see.
       */
      /*
       * The HUD's own bar height, handed to the renderer.
       *
       * The renderer draws a control anchored to a cell in the world and has to
       * keep it clear of the strip across the top. The HUD is the only thing
       * that knows how tall that strip is on this screen.
       */
      this.renderer.hudTop = this.hud.playTop;

      const openGate = this.hud.gateCardVisible ? run.gates.find((g) => g.id === run.openGateId) : undefined;
      this.input.gateCard = openGate
        ? {
            optionCount: openGate.options.length,
            hasReadLine: openGate.options.some((id) => {
              const ally = run.allies.find((a) => a.id === id);
              return ally !== undefined && !ally.known;
            }),
            top: this.hud.playTop,
          }
        : null;

      /*
       * Where the cell button is, if a cell is in reach.
       *
       * Recomputed from the run each frame for the same reason the gate card is:
       * a cell the player has flown away from must not leave a live tap target
       * behind in empty air.
       */
      const cell = cellInReach(run);
      const chargeCost = CONSUMABLES[0]?.cost ?? 0;
      this.input.breachButton =
        cell && run.purse.held >= chargeCost
          ? breachButtonAt({
              cell: this.camera.worldToScreen(cell.x, cell.y),
              width: this.renderer.width,
              height: this.renderer.height,
              top: this.hud.playTop,
            })
          : null;

      this.hud.draw(
        this.renderer.context,
        run,
        this.input,
        this.renderer.width,
        this.renderer.height,
      );
    }

    this.renderer.observeFrame(performance.now() - startedAt);
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

  /** Set while a resize is already queued, so a burst collapses into one. */
  private resizePending = false;

  /**
   * Resize once per frame, however many events arrive.
   *
   * A fullscreen transition fires resize continuously while the window
   * animates, and orientation changes on a phone do the same. Each event was
   * doing the full job: reallocate the canvas, recompute the camera, remeasure
   * the HUD. Coalescing to one per frame turns a storm into a single piece of
   * work, and the frame it lands on is the one that was going to draw anyway.
   */
  private onResize = (): void => {
    if (this.resizePending) return;
    this.resizePending = true;

    requestAnimationFrame(() => {
      this.resizePending = false;
      this.applyResize();
    });
  };

  /**
   * The resize itself, done now.
   *
   * Boot calls this directly rather than going through the coalescing path.
   * Waiting a frame for the first sizing would draw one frame at whatever the
   * canvas happened to be, which is a visible flash on the very first thing
   * anybody sees.
   */
  private applyResize(): void {
    this.renderer.resize();
    this.camera.resize(this.renderer.width, this.renderer.height);
    this.hud.measure();
  }
}

/*
 * Correct the app box before anything measures itself against it.
 *
 * Ahead of the App, because the renderer sizes its canvas from the element on
 * the first frame and an uncorrected box would draw one frame at the wrong
 * height. On Android that frame is the one with the consumable strip off the
 * bottom of the screen.
 */
trackViewport();

void initialiseIdentity().then(async (identity) => {
  void registerPlayerCredential(identity.publicKeyJwk);
  const app = new App();
  if (import.meta.env.DEV) {
    (window as unknown as { sface: unknown }).sface = app;
  }
  await app.boot();
}).catch((error) => {
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
