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
import { audio } from './core/audio';
import { setLanguage, t } from './data/copy';
import { loadMission, utcDate, type DailyMission } from './game/mission';
import { RunState } from './game/state';
import { step } from './game/update';
import type { PlayerCommand } from './game/player';
import { GhostRecorder, decodeTrace, type GhostFrame } from './game/ghost';
import { Squad } from './game/squad';
import { LiveLink } from './net/live';
import { Camera } from './render/camera';
import { Renderer } from './render/renderer';
import { Hud } from './render/hud';
import { Effects } from './render/effects';
import { renderBoard, renderBrief, renderLoading, renderResults } from './ui/screens';
import { renderChallenge } from './ui/challenge';
import { cardDataFrom, drawScoreCard, shareLink, shareRun } from './ui/share';
import {
  acceptChallenge,
  apiConfigured,
  createChallenge,
  fetchBoard,
  fetchChallenge,
  fetchGhosts,
  postGhost,
  postScore,
  reportSettlement,
  type BoardEntry,
  type Challenge,
} from './net/api';
import { pilotId, pilotName, upgradeTo } from './net/identity';
import { connect, askDeviceId, type WalletSession } from './nimiq/wallet';
import { settle } from './nimiq/payments';
import { challengeDeeplink, readChallengeId } from './nimiq/deeplink';

type Screen = 'loading' | 'brief' | 'run' | 'results' | 'board' | 'challenge';

/** Default stake when a player creates a challenge without picking one. */
const DEFAULT_STAKE_NIM = 5;

class App {
  private readonly ui: HTMLElement;
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

  private screen: Screen = 'loading';
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

  private firstRun = true;
  private lastHealth = 0;
  /** Dev-only steering, set by debug().advance. Null in every normal frame. */
  private commandOverride: PlayerCommand | null = null;
  private rank: number | null = null;
  private cardUrl: string | null = null;
  private postError: string | null = null;

  private challenge: Challenge | null = null;
  private pendingChallengeId: string | null = null;
  private challengeNotice: string | null = null;
  private settling = false;

  constructor() {
    const canvas = document.querySelector<HTMLCanvasElement>('#stage');
    const ui = document.querySelector<HTMLElement>('#ui');
    if (!canvas || !ui) throw new Error('The page is missing #stage or #ui.');

    this.ui = ui;
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    this.onResize();
  }

  async boot(): Promise<void> {
    setLanguage(navigator.language);
    renderLoading(this.ui, t('loadingMission'));

    // The wallet probe runs alongside the mission fetch rather than before it.
    // Whichever finishes first, the player is not waiting on the other.
    void this.probeWallet();

    this.pendingChallengeId = readChallengeId();

    const { mission, notice } = await loadMission();
    this.mission = mission;
    this.notice = notice;
    setLanguage(this.session?.language ?? navigator.language);

    this.prepareRun();
    this.loop.start();

    // Fetched in the background. Squadmates are a bonus, never a gate on
    // starting a run, so nothing below waits on this.
    void this.loadGhosts();

    if (this.pendingChallengeId) await this.openChallenge(this.pendingChallengeId);
    else this.showBrief();
  }

  /**
   * Pull the best recorded runs on today's seed. They fly beside you next run.
   *
   * This is what makes a solo game feel populated on day one: the first player
   * of the day flies alone, and everyone after them flies with whoever came
   * before. No matchmaking, no lobby, no waiting for a second human.
   */
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

  private async probeWallet(): Promise<void> {
    this.session = await connect();
    setLanguage(this.session.language);
    // Re-render whatever is up, since the language may have just changed.
    if (this.screen === 'brief') this.showBrief();
  }

  // Screens ---------------------------------------------------------------

  private showBrief(): void {
    const mission = this.mission;
    if (!mission) return;

    this.screen = 'brief';
    renderBrief(this.ui, {
      mission,
      notice: this.notice,
      showHints: this.firstRun,
      onStart: () => this.startRun(),
      onBoard: () => void this.showBoard(),
    });
  }

  private startRun(): void {
    // The first tap of the session is the only chance to start audio.
    audio.unlock();
    audio.play('ui');

    this.prepareRun();
    this.firstRun = false;
    this.rank = null;
    this.cardUrl = null;
    this.postError = null;
    this.screen = 'run';
    this.ui.replaceChildren();
  }

  private prepareRun(): void {
    const mission = this.mission;
    if (!mission) return;

    this.run = new RunState(mission);
    this.lastHealth = this.run.player.health;
    this.effects.clear();
    this.input.reset();
    this.recorder.reset();
    this.camera.jumpTo(this.run.player, this.run.terrain.groundAt(this.run.player.x));

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

    this.screen = 'results';
    this.input.reset();
    audio.play(run.phase === 'extracted' ? 'extract' : 'down');

    const data = cardDataFrom(run, null);
    this.cardUrl = drawScoreCard(data);

    // Paint the results immediately, then fill in rank and challenge state as
    // the network answers. A good run should never wait on a leaderboard.
    this.showResults();

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
      name: pilotName(this.pilot),
      seed: run.mission.seed,
      score: run.score,
      facesExtracted: run.facesExtracted,
      trace: this.recorder.encode(),
    });

    // Refresh the pool so the next run reflects who else has posted since.
    void this.loadGhosts();
  }

  private showResults(): void {
    const run = this.run;
    if (!run) return;

    if (this.challenge) {
      this.showChallengeScreen();
      return;
    }

    this.screen = 'results';
    renderResults(this.ui, {
      state: run,
      cardUrl: this.cardUrl,
      postError: this.postError,
      rank: this.rank,
      onReplay: () => this.startRun(),
      onChallenge: () => void this.createChallenge(),
      onShare: () => void this.share(),
      onBoard: () => void this.showBoard(),
    });
  }

  private async showBoard(): Promise<void> {
    const mission = this.mission;
    if (!mission) return;

    this.screen = 'board';
    renderLoading(this.ui, t('boardTitle'));

    let entries: BoardEntry[] = [];
    let offline = !apiConfigured();

    if (!offline) {
      const result = await fetchBoard(mission.date);
      if (result.ok) entries = result.value;
      else offline = true;
    }

    if (this.screen !== 'board') return;

    renderBoard(this.ui, {
      mission,
      entries,
      meId: this.pilot,
      offline,
      onBack: () => (this.run?.finished ? this.showResults() : this.showBrief()),
    });
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

    const result = await postScore({
      deviceId: this.pilot,
      name: pilotName(this.pilot),
      date: run.mission.date,
      seed: run.mission.seed,
      score: run.score,
      facesExtracted: run.facesExtracted,
      attackersCleared: run.attackersCleared,
      duration: run.time,
    });

    if (result.ok) {
      this.rank = result.value.rank;
      this.cardUrl = drawScoreCard(cardDataFrom(run, this.rank));
      this.postError = null;
    } else {
      this.postError = t('errorBoardPost');
    }
  }

  private async createChallenge(): Promise<void> {
    const run = this.run;
    if (!run) return;

    if (!apiConfigured()) {
      this.postError = 'Challenges need the service. Playing solo for now.';
      this.showResults();
      return;
    }

    // A challenge needs a wallet address to pay to, and that is the one thing
    // an identifier cannot stand in for. Say so before creating a dead bet.
    if (!this.session?.address) {
      this.postError = t('challengeNoWallet');
      this.showResults();
      return;
    }

    const result = await createChallenge({
      deviceId: this.pilot,
      name: pilotName(this.pilot),
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
    this.screen = 'challenge';
    renderLoading(this.ui, t('challengeTitle'));

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
      name: pilotName(this.pilot),
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

  private async share(): Promise<void> {
    const run = this.run;
    if (!run) return;
    const data = cardDataFrom(run, this.rank);
    await shareRun(data, this.cardUrl, window.location.origin);
  }

  private async shareChallenge(): Promise<void> {
    const challenge = this.challenge;
    if (!challenge) return;

    const link = challengeDeeplink(challenge.id);

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

    await shareRun(cardDataFrom(run, this.rank), this.cardUrl, link);
  }

  // Loop -------------------------------------------------------------------

  private update(dt: number): void {
    const run = this.run;
    if (!run) return;

    if (this.screen === 'run' && !run.finished) {
      step(run, dt, this.command());
      this.watchDamage(run);
      // Record after the step, so a frame is the pose the player ended it in.
      this.recorder.sample(run);
      this.live?.publish(poseOf(run), performance.now());
    }

    this.camera.follow(run.player, run.terrain.groundAt(run.player.x), dt);
    // Squadmates read the run clock, which is why a recording made yesterday
    // lines up with a run happening now without any synchronisation.
    this.squad.update(run.time, dt);
    this.effects.consume(run.events, this.camera);
    this.effects.update(dt);

    if (this.screen === 'run' && run.finished) {
      void this.endRun();
    }
  }

  /** Turn raw input into the command the simulation takes. */
  private command(): PlayerCommand {
    // Set only by the dev-only advance() helper, so an automated run can steer.
    if (this.commandOverride) return this.commandOverride;

    const aim = this.input.aim
      ? this.camera.screenToWorld(this.input.aim.x, this.input.aim.y)
      : null;

    if (this.input.firing) audio.play('shoot');

    return {
      moveX: this.input.move.x,
      moveY: this.input.move.y,
      aimX: aim?.x ?? null,
      aimY: aim?.y ?? null,
      firing: this.input.firing,
    };
  }

  /** Effects and audio react to health, which the run itself knows nothing about. */
  private watchDamage(run: RunState): void {
    if (run.player.health < this.lastHealth) {
      this.effects.damageFlash();
      this.camera.shake(9);
      audio.play('hit');
    }
    this.lastHealth = run.player.health;
  }

  private render(): void {
    const run = this.run;
    if (!run) return;

    this.renderer.draw(run, this.camera, this.effects, this.squad);

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
    advance: (seconds: number, command?: Partial<PlayerCommand>) => void;
  } {
    return {
      run: this.run,
      screen: this.screen,
      squad: this.squad,
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
    wrap.className = 'screen screen--center';
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
