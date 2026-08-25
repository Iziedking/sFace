import { generateRelayMission } from '../../shared/relay/mission';
import { RELAY_RULESET } from '../../shared/relay/ruleset';
import { createRelayState, type RelayState } from '../../shared/relay/state';
import { deriveRelayResult } from '../../shared/relay/score';
import { stepRelay } from '../../shared/relay/step';
import { fetchRelayBootstrap, fetchRelayDay, fetchRelayWorld, findRelayRun, RelayApiError, requestRelayAttempt, requestRelayWalletChallenge, submitRelayRun, submitRelayWalletBinding, type RelayAttemptTicket, type RelayPublicDay, type RelayRunStatus, type RelayWorldSnapshot } from './api';
import { createRelayAppState, relayAppReducer, type RelayAppEvent, type RelayAppState } from './app-state';
import { requestRelayWalletBinding, getRelayWalletAccount } from './nimiq/binding';
import { initialiseIdentity } from '../net/identity';
import { registerPlayerCredential } from '../net/api';
import { installRelayKeyboardInput } from './input/keyboard';
import { RelayInputSampler } from './input/sampler';
import { installRelayTouchInput } from './input/touch';
import { RelayRenderer } from './render/renderer';
import { renderRelayError } from './screens/error';
import { renderRelayResult } from './screens/result';
import { renderRelayRules } from './screens/rules';
import { renderRelayRun } from './screens/run';
import { renderRelaySeason } from './screens/season';
import { renderRelayToday } from './screens/today';
import { renderRelaySubmissionStatus } from './screens/submission';
import { createRelayShareCard } from './share/card';
import { createPendingRunStore } from './pending-runs';
import { RelayTraceRecorder, submitCompletedRelayRun } from './submission';
import { updateRelayRunHud, type RelayRunHudState } from './run-hud';
import type { RelayResult, RelayTrace } from '../../shared/relay/types';

const TICK_MS = 1_000 / RELAY_RULESET.tickRate;

class RelayApp {
  private readonly ui: HTMLElement;
  private readonly renderer: RelayRenderer;
  private readonly sampler = new RelayInputSampler();
  private readonly pendingRuns = createPendingRunStore();
  private readonly missionDate = new Date().toISOString().slice(0, 10);
  private state: RelayAppState = createRelayAppState();
  private relayState: RelayState | null = null;
  private world: RelayWorldSnapshot | null = null;
  private lastFrame = 0;
  private accumulator = 0;
  private lastUiRender = 0;
  private countdownTimer: number | null = null;
  private traceRecorder: RelayTraceRecorder | null = null;
  private competitiveSession: {
    actorId: string;
    walletAddress: string;
    network: 'main' | 'test';
    ticket: RelayAttemptTicket;
    day: RelayPublicDay & { seedHex: string };
    completed?: { runId: string; trace: RelayTrace; result: RelayResult };
  } | null = null;

  constructor(ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.ui = ui;
    this.renderer = new RelayRenderer(canvas);
    installRelayTouchInput(canvas, (value) => this.sampler.setTouchSteer(value));
    installRelayKeyboardInput(window, (value) => this.sampler.setKeyboardSteer(value), () => this.sampler.clearKeyboardSteer());
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', this.interrupt);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async boot(): Promise<void> {
    this.registerOfflineShell();
    this.resize();
    let message: string | null = null;
    try { await fetchRelayBootstrap(); this.world = await fetchRelayWorld(); } catch { message = 'Network unavailable. Practice is ready; verified competition needs a connection.'; }
    this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate, message });
  }

  private registerOfflineShell(): void {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined);
  }

  private dispatch(event: RelayAppEvent): void { this.state = relayAppReducer(this.state, event); this.render(); }

  private beginCountdown = (): void => { this.startCountdown({ type: 'RESCUE_NOW' }); };

  private beginCompetitiveCountdown = (): void => { this.startCountdown({ type: 'COMPETITIVE_READY' }); };

  private startCountdown(event: RelayAppEvent): void {
    if (this.countdownTimer !== null) window.clearInterval(this.countdownTimer);
    let value = 3;
    this.dispatch(event);
    this.countdownTimer = window.setInterval(() => {
      value -= 1;
      this.dispatch({ type: 'COUNTDOWN_TICK', value });
      if (value <= 0 && this.countdownTimer !== null) {
        window.clearInterval(this.countdownTimer); this.countdownTimer = null;
        this.startRun();
      }
    }, 700);
  }

  private startRun(): void {
    const competitive = this.state.runKind === 'competitive' ? this.competitiveSession : null;
    if (this.state.runKind === 'competitive' && !competitive) {
      this.dispatch({ type: 'ERROR', message: 'The competitive ticket was lost before the run started.' });
      return;
    }
    const seed = competitive?.day.seedHex ?? practiceSeed(this.missionDate);
    this.relayState = createRelayState(generateRelayMission(seed, RELAY_RULESET));
    this.traceRecorder = competitive ? new RelayTraceRecorder({ missionDate: competitive.day.date, seedCommitment: competitive.day.seedCommitment, ticketId: competitive.ticket.id }) : null;
    this.lastFrame = performance.now(); this.lastUiRender = this.lastFrame; this.accumulator = 0;
    this.dispatch({ type: 'COUNTDOWN_TICK', value: 0 });
    requestAnimationFrame(this.frame);
  }

  private frame = (timestamp: number): void => {
    const elapsed = Math.min(250, timestamp - this.lastFrame); this.lastFrame = timestamp;
    if (this.state.screen === 'running' && this.relayState) {
      this.accumulator += elapsed;
      while (this.accumulator >= TICK_MS && this.relayState.phase === 'running') {
        const steerX = this.sampler.sample();
        this.traceRecorder?.record(steerX);
        stepRelay(this.relayState, { steerX, flags: 0 }, RELAY_RULESET);
        this.accumulator -= TICK_MS;
      }
      if (this.relayState.phase === 'finished') {
        const result = deriveRelayResult(this.relayState, RELAY_RULESET);
        if (this.state.runKind === 'competitive') {
          const trace = this.traceRecorder?.finish();
          if (!trace || !this.competitiveSession) {
            this.dispatch({ type: 'SUBMIT_REJECTED', message: 'The competitive trace could not be completed.' });
            return;
          }
          this.competitiveSession.completed = { runId: crypto.randomUUID(), trace, result };
          this.dispatch({ type: 'SUBMITTING' });
          void this.submitCompetitiveResult();
          return;
        }
        this.dispatch({ type: 'PRACTICE_FINISHED', score: result.score, completedTicks: result.completedTicks });
        return;
      }
    }
    if (this.relayState) this.renderer.draw(this.relayState);
    if (timestamp - this.lastUiRender >= 100 && this.relayState) {
      updateRelayRunHud(this.ui, this.currentHudState());
      this.lastUiRender = timestamp;
    }
    requestAnimationFrame(this.frame);
  };

  private interrupt = (): void => { if (this.state.screen === 'running') this.dispatch({ type: 'PAUSE', reason: 'blur' }); };
  private onVisibility = (): void => { if (document.hidden && this.state.screen === 'running') this.dispatch({ type: 'PAUSE', reason: 'visibility' }); };

  private finishAndRenderToday = (): void => { this.relayState = null; this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate }); };
  private submitVerified = async (): Promise<void> => {
    this.dispatch({ type: 'AUTHORIZE' });
    try {
      const identity = await initialiseIdentity();
      const registered = await registerPlayerCredential(identity.publicKeyJwk);
      if (!registered.ok) throw new Error(registered.error);
      const account = await getRelayWalletAccount();
      const challenge = await requestRelayWalletChallenge({ actorId: identity.playerId, address: account.address, network: account.network });
      const proof = await requestRelayWalletBinding(challenge, account.provider);
      await submitRelayWalletBinding(proof);
      const ticket = await requestRelayAttempt({ actorId: identity.playerId, missionDate: this.missionDate, network: account.network });
      const day = await fetchRelayDay(this.missionDate);
      if (day.status !== 'open' || !day.seedHex || day.ruleset !== ticket.ruleset || day.date !== ticket.missionDate) throw new Error('The competitive mission is not open. Your practice result is preserved.');
      this.competitiveSession = { actorId: identity.playerId, walletAddress: account.address, network: account.network, ticket, day: { ...day, seedHex: day.seedHex } };
      this.beginCompetitiveCountdown();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') this.dispatch({ type: 'AUTH_DECLINED' });
      else this.dispatch({ type: 'SUBMIT_RETRYABLE', message: error instanceof Error ? error.message : 'Competitive authorization could not be completed.' });
    }
  };

  private submitCompetitiveResult = async (): Promise<void> => {
    const session = this.competitiveSession;
    const completed = session?.completed;
    if (!session || !completed) {
      this.dispatch({ type: 'SUBMIT_REJECTED', message: 'No completed competitive trace is available.' });
      return;
    }
    try {
      const receipt = await submitCompletedRelayRun({
        store: this.pendingRuns,
        runId: completed.runId,
        actorId: session.actorId,
        walletAddress: session.walletAddress,
        network: session.network,
        trace: completed.trace,
        result: completed.result,
        createdAt: Date.now(),
        query: findRelayRun,
        send: submitRelayRun,
      });
      const verified = verifiedRelayResult(receipt);
      if (!verified) throw new Error('The server returned an invalid verification receipt.');
      this.dispatch({ type: 'SUBMIT_VERIFIED', score: verified.score, completedTicks: verified.completedTicks });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The run is safely retained and can be retried.';
      if (isHardRelayRejection(error)) this.dispatch({ type: 'SUBMIT_REJECTED', message });
      else this.dispatch({ type: 'SUBMIT_RETRYABLE', message });
    }
  };
  private render(): void {
    this.ui.replaceChildren();
    if (this.state.screen === 'boot') return;
    if (this.state.screen === 'today') this.ui.append(renderRelayToday({ practice: true, world: this.world, onRescue: this.beginCountdown, onSeason: () => this.dispatch({ type: 'OPEN_SEASON' }), onRules: () => this.dispatch({ type: 'OPEN_RULES' }), onShare: () => void this.shareWorldProgress(), message: this.state.message }));
    else if (this.state.screen === 'countdown' || this.state.screen === 'running' || this.state.screen === 'paused') this.ui.append(renderRelayRun({ countdown: this.state.countdown, paused: this.state.screen === 'paused', onPause: () => this.dispatch({ type: 'PAUSE', reason: 'webview' }), onResume: () => this.dispatch({ type: 'RESUME' }), onSteer: (value) => this.sampler.setTouchSteer(value), state: { score: this.relayState ? deriveRelayResult(this.relayState, RELAY_RULESET).score : 0, integrity: this.relayState?.pod.integrity ?? 3, carried: this.relayState?.carrying ?? 0, banked: this.relayState?.bankedNodes ?? 0, seconds: (this.relayState?.completedTicks ?? 0) / RELAY_RULESET.tickRate } }));
    else if (this.state.screen === 'practice-result' && this.state.result) this.ui.append(renderRelayResult({ ...this.state.result, onAgain: this.finishAndRenderToday, onSeason: () => this.dispatch({ type: 'OPEN_SEASON' }), onSubmit: this.submitVerified, message: this.state.message }));
    else if (this.state.screen === 'verified-result' && this.state.result) this.ui.append(renderRelayResult({ ...this.state.result, verified: true, onAgain: this.finishAndRenderToday, onSeason: () => this.dispatch({ type: 'OPEN_SEASON' }) }));
    else if (this.state.screen === 'authorization') this.ui.append(renderRelaySubmissionStatus({ heading: 'Authorize competitive proof', message: 'Confirm the wallet challenge. No payment or transaction is requested.', busy: true, onBack: this.finishAndRenderToday }));
    else if (this.state.screen === 'submitting') this.ui.append(renderRelaySubmissionStatus({ heading: 'Replaying your run', message: 'The server is deriving the authoritative result from every recorded input.', busy: true, onBack: this.finishAndRenderToday }));
    else if (this.state.screen === 'retryable-failure') this.ui.append(renderRelaySubmissionStatus({ heading: 'Submission paused', message: this.state.message ?? 'The exact run is retained for recovery.', retryLabel: 'Retry retained run', onRetry: this.submitCompetitiveResult, onBack: this.finishAndRenderToday }));
    else if (this.state.screen === 'hard-rejection') this.ui.append(renderRelaySubmissionStatus({ heading: 'Run not accepted', message: this.state.message ?? 'The server refused this competitive proof.', onBack: this.finishAndRenderToday }));
    else if (this.state.screen === 'season') this.ui.append(renderRelaySeason(() => this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate }), this.world));
    else if (this.state.screen === 'rules') this.ui.append(renderRelayRules(() => this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate })));
    else if (this.state.screen === 'error') this.ui.append(renderRelayError(this.state.message ?? 'Try again when the service is reachable.', () => this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate })));
    else this.ui.append(renderRelayError(this.state.message ?? 'Competitive submission is not available in practice mode.', this.finishAndRenderToday));
  }

  private resize = (): void => { this.renderer.resize(); if (this.relayState) this.renderer.draw(this.relayState); };

  private currentHudState(): RelayRunHudState {
    return {
      score: this.relayState ? deriveRelayResult(this.relayState, RELAY_RULESET).score : 0,
      integrity: this.relayState?.pod.integrity ?? 3,
      carried: this.relayState?.carrying ?? 0,
      banked: this.relayState?.bankedNodes ?? 0,
      seconds: (this.relayState?.completedTicks ?? 0) / RELAY_RULESET.tickRate,
    };
  }

  private async shareWorldProgress(): Promise<void> {
    if (!this.world) return;
    const card = createRelayShareCard({ variant: 'community-deficit', verified: true, missionDate: this.missionDate, score: 0, completedTicks: 0, repairUnits: 0, world: this.world });
    const file = new File([card.svg], card.filename, { type: 'image/svg+xml' });
    try {
      if (typeof navigator.share === 'function') {
        const payload: ShareData = { title: 'NIM Rescue Relay', text: card.text };
        if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) payload.files = [file];
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard?.writeText(card.text);
      this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate, message: 'Progress copy ready to share.' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      this.dispatch({ type: 'PRACTICE_READY', missionDate: this.missionDate, message: 'Sharing is unavailable on this device.' });
    }
  }
}

function verifiedRelayResult(receipt: RelayRunStatus | { verification: 'verified'; result: RelayRunStatus['result'] }): RelayRunStatus['result'] | null {
  if ('status' in receipt && receipt.status === 'verified') return receipt.result;
  if ('verification' in receipt && receipt.verification === 'verified') return receipt.result;
  return null;
}

function isHardRelayRejection(error: unknown): boolean {
  if (!(error instanceof RelayApiError)) return false;
  return [
    'relay_invalid_trace',
    'relay_ticket_expired',
    'relay_ticket_used',
    'relay_ticket_unavailable',
    'relay_day_unavailable',
    'relay_wallet_unbound',
    'relay_duplicate_run',
    'relay_trace_reused',
  ].includes(error.code);
}

function practiceSeed(date: string): string {
  const bytes = new TextEncoder().encode(date);
  const seed = new Uint8Array(32);
  for (let index = 0; index < seed.length; index += 1) seed[index] = (bytes[index % bytes.length]! + index * 17) & 0xff;
  return Array.from(seed, (value) => value.toString(16).padStart(2, '0')).join('');
}

const ui = document.querySelector<HTMLElement>('#ui');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (ui && canvas) void new RelayApp(ui, canvas).boot();
