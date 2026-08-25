import { randomUUID } from 'node:crypto';
import type { Express, RequestHandler } from 'express';

import { canonicalRelayTraceBytes, hashRelayTrace } from '../../shared/relay/trace';
import { generateRelayMission } from '../../shared/relay/mission';
import { replayRelayTrace } from '../../shared/relay/replay';
import { RELAY_RULESET } from '../../shared/relay/ruleset';
import type { RelayRunRecord, RelayTrace } from '../../shared/relay/types';
import type { RelayConfig } from './config';
import { parseRelayBody, relayAttemptSchema, relayDateSchema, relayRunSchema, relayWalletBindingProofSchema, relayWalletChallengeSchema } from './schemas';
import type { RelayDailyService } from './daily';
import type { RelayRepository } from './repository';
import type { RelayTicketService } from './tickets';
import type { RelayWalletBindingProof, RelayWalletBindingService } from './wallet-bindings';
import type { RelayWorldService } from './world';
import type { RelayLeaderboardService } from './leaderboard';
import type { RelayRewardService } from './rewards';

export interface RelayApi {
  bootstrap(): Promise<unknown>;
  attempt?(input: { actorId: string; missionDate: string; network: 'main' | 'test' }): Promise<unknown>;
  walletChallenge?(input: { actorId: string; address: string; network: 'main' | 'test' }): Promise<unknown>;
  walletBind?(input: RelayWalletBindingProof): Promise<unknown>;
  run?(input: {
    id: string; actorId: string; ticketId: string; walletAddress: string; missionDate: string; network: 'main' | 'test'; ruleset: 'relay-1'; seedCommitment: string; traceHash: string; trace: RelayTrace; result: Record<string, unknown>;
  }): Promise<unknown>;
  day?(date: string): Promise<unknown>;
  world?(): Promise<unknown>;
  leaderboard?(period: string): Promise<unknown>;
  rewards?(): Promise<unknown>;
  runStatus?(runId: string): Promise<unknown | null>;
  replay?(runId: string): Promise<unknown>;
}

export function createRelayApi(options: { config: RelayConfig; bootstrap?: () => Promise<unknown>; tickets?: RelayTicketService; walletBindings?: RelayWalletBindingService; daily?: RelayDailyService; repository?: RelayRepository; actorExists?: (actorId: string) => boolean; world?: RelayWorldService; leaderboard?: RelayLeaderboardService; rewards?: RelayRewardService }): RelayApi {
  return {
    async bootstrap() {
      if (options.bootstrap) return options.bootstrap();
      return options.config.enabled && options.config.competitiveEnabled
        ? { mode: 'competitive', competitive: true, rewardsEnabled: options.config.rewardsEnabled }
        : { mode: 'practice', competitive: false, rewardsEnabled: false, reason: options.config.rewardsDisabledReason };
    },
    async walletChallenge(input) {
      if (!options.config.enabled || !options.walletBindings) throw new Error('relay_competitive_disabled');
      if (options.actorExists && !options.actorExists(input.actorId)) throw new Error('relay_actor_invalid');
      return options.walletBindings.issueChallenge(input);
    },
    async walletBind(input) {
      if (!options.config.enabled || !options.walletBindings) throw new Error('relay_competitive_disabled');
      return options.walletBindings.bind(input);
    },
    async attempt(input) {
      if (!options.config.enabled || !options.config.competitiveEnabled || !options.tickets || !options.walletBindings) throw new Error('relay_competitive_disabled');
      if (!await options.walletBindings.isBound(input.actorId, input.network)) throw new Error('relay_wallet_unbound');
      return options.tickets.issue(input);
    },
    async run(input) {
      if (!options.config.enabled || !options.config.competitiveEnabled || !options.tickets || !options.walletBindings || !options.daily || !options.repository) throw new Error('relay_competitive_disabled');
      const binding = await options.walletBindings.getBinding(input.actorId, input.network);
      if (!binding || binding.address !== input.walletAddress) throw new Error('relay_wallet_unbound');
      const day = options.daily.getDay(input.missionDate);
      if (!day || day.status !== 'open' || day.seedCommitment !== input.seedCommitment) throw new Error('relay_day_unavailable');
      const ticket = await options.tickets.consume({ ticketId: input.ticketId, actorId: input.actorId, runId: input.id });
      if (ticket.missionDate !== input.missionDate) throw new Error('relay_ticket_unavailable');
      const trace = input.trace;
      if (trace.ticketId !== input.ticketId) throw new Error('relay_invalid_trace');
      const traceBytes = canonicalRelayTraceBytes(trace);
      const traceHash = await hashRelayTrace(trace);
      if (traceHash !== input.traceHash) throw new Error('relay_invalid_trace');
      const mission = generateRelayMission(day.seedHex, RELAY_RULESET);
      const replay = replayRelayTrace({ ...mission, missionDate: day.date, seedCommitment: day.seedCommitment }, trace, RELAY_RULESET, input.result);
      const run: RelayRunRecord = { id: input.id, actorId: input.actorId, ticketId: input.ticketId, walletAddress: binding.address, missionDate: input.missionDate, ruleset: input.ruleset, seedCommitment: input.seedCommitment, traceHash, result: replay, verification: 'verified', receivedAt: Date.now() };
      const accepted = await options.repository.acceptRun(run, traceBytes);
      if (options.world) await options.world.apply({ missionDate: run.missionDate, actorId: run.actorId, repairUnits: run.result.repairUnits, target: day.target ?? 10_000, unlockThresholds: day.unlockThresholds });
      return accepted;
    },
    async runStatus(runId) {
      if (!options.repository) throw new Error('relay_service_unavailable');
      const run = await options.repository.getRun(runId);
      if (!run) return null;
      return {
        runId: run.id,
        status: run.verification,
        missionDate: run.missionDate,
        ruleset: run.ruleset,
        result: run.result,
        receivedAt: run.receivedAt,
      };
    },
    async world() {
      if (!options.world) throw new Error('relay_service_unavailable');
      return options.world.get(new Date().toISOString().slice(0, 10));
    },
    async leaderboard(period) {
      if (!options.leaderboard) throw new Error('relay_service_unavailable');
      return options.leaderboard.daily(/^\d{4}-\d{2}-\d{2}$/.test(period) ? period : new Date().toISOString().slice(0, 10));
    },
    async rewards() {
      if (!options.rewards) throw new Error('relay_service_unavailable');
      return options.config.rewardsEnabled ? options.rewards.publicRecords() : { status: 'disabled', reason: options.config.rewardsDisabledReason };
    },
  };
}

export interface RelayRouteDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  api: RelayApi;
}

export function mountRelayRoutes(deps: RelayRouteDeps): void {
  const { app, limit, api } = deps;
  app.get('/relay/api/bootstrap', limit(120, 40), async (req, res) => {
    try {
      res.setHeader('cache-control', 'no-store');
      res.json({ ok: true, data: await api.bootstrap() });
    } catch (error) {
      relayError(res, error, req);
    }
  });
  app.post('/relay/api/attempts', limit(20, 10), async (req, res) => {
    const parsed = parseRelayBody(relayAttemptSchema, req.body);
    if (!parsed.ok) { relayError(res, new Error(parsed.error), req, 400); return; }
    try {
      if (!api.attempt) throw new Error('relay_competitive_disabled');
      res.status(201).json({ ok: true, data: await api.attempt(parsed.value) });
    } catch (error) {
      relayError(res, error, req);
    }
  });
  app.post('/relay/api/runs', limit(10, 5), async (req, res) => {
    const parsed = parseRelayBody(relayRunSchema, req.body);
    if (!parsed.ok) { relayError(res, new Error(parsed.error), req, 400); return; }
    try {
      if (!api.run) throw new Error('relay_competitive_disabled');
      res.status(201).json({ ok: true, data: await api.run(parsed.value as unknown as Parameters<NonNullable<RelayApi['run']>>[0]) });
    } catch (error) { relayError(res, error, req); }
  });
  app.post('/relay/api/wallet-bindings/challenge', limit(20, 10), async (req, res) => {
    const parsed = parseRelayBody(relayWalletChallengeSchema, req.body);
    if (!parsed.ok) { relayError(res, new Error(parsed.error), req, 400); return; }
    try {
      if (!api.walletChallenge) throw new Error('relay_competitive_disabled');
      res.status(201).json({ ok: true, data: await api.walletChallenge(parsed.value) });
    } catch (error) { relayError(res, error, req); }
  });
  app.post('/relay/api/wallet-bindings', limit(20, 10), async (req, res) => {
    const parsed = parseRelayBody(relayWalletBindingProofSchema, req.body);
    if (!parsed.ok) { relayError(res, new Error(parsed.error), req, 400); return; }
    try {
      if (!api.walletBind) throw new Error('relay_competitive_disabled');
      res.status(201).json({ ok: true, data: await api.walletBind(parsed.value) });
    } catch (error) { relayError(res, error, req); }
  });
  app.get('/relay/api/days/:date', limit(120, 40), async (req, res) => {
    const parsed = relayDateSchema.safeParse(req.params.date);
    if (!parsed.success) { relayError(res, new Error('relay_invalid_date'), req, 400); return; }
    try { if (!api.day) throw new Error('relay_service_unavailable'); res.json({ ok: true, data: await api.day(parsed.data) }); } catch (error) { relayError(res, error, req); }
  });
  app.get('/relay/api/world', limit(120, 40), async (req, res) => {
    try { if (!api.world) throw new Error('relay_service_unavailable'); res.json({ ok: true, data: await api.world() }); } catch (error) { relayError(res, error, req); }
  });
  app.get('/relay/api/leaderboards/:period', limit(120, 40), async (req, res) => {
    try { if (!api.leaderboard) throw new Error('relay_service_unavailable'); res.json({ ok: true, data: await api.leaderboard(String(req.params.period ?? '')) }); } catch (error) { relayError(res, error, req); }
  });
  app.get('/relay/api/rewards', limit(120, 40), async (req, res) => {
    try { if (!api.rewards) throw new Error('relay_service_unavailable'); res.json({ ok: true, data: await api.rewards() }); } catch (error) { relayError(res, error, req); }
  });
  app.get('/relay/api/runs/:runId', limit(60, 20), async (req, res) => {
    try {
      if (!api.runStatus) throw new Error('relay_service_unavailable');
      const data = await api.runStatus(String(req.params.runId ?? ''));
      if (!data) { res.status(404).json({ ok: false, error: 'relay_run_not_found' }); return; }
      res.json({ ok: true, data });
    } catch (error) { relayError(res, error, req); }
  });
  app.get('/relay/api/runs/:runId/replay', limit(60, 20), async (req, res) => {
    try { if (!api.replay) throw new Error('relay_service_unavailable'); res.json({ ok: true, data: await api.replay(String(req.params.runId ?? '')) }); } catch (error) { relayError(res, error, req); }
  });
}

function relayError(response: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void }, error: unknown, request: { header?: (name: string) => string | undefined }, status = 503): void {
  const candidate = error as { code?: unknown };
  const code = typeof candidate?.code === 'string' && candidate.code.startsWith('relay_')
    ? candidate.code
    : error instanceof Error && error.message.startsWith('relay_') ? error.message : 'relay_service_unavailable';
  const requestId = request.header?.('x-request-id') ?? randomUUID();
  response.status(status).json({ ok: false, error: code, requestId });
}
