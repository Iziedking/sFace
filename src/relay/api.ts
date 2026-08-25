export interface RelayBootstrap {
  mode: 'practice' | 'competitive';
  competitive: boolean;
  rewardsEnabled?: boolean;
  reason?: string | null;
}

export interface RelayWorldSnapshot {
  missionDate: string;
  target: number;
  unlockThresholds: number[];
  repairTotal: number;
  verifiedPlayerCount: number;
  projectionVersion: number;
  lastUpdatedAt: number;
}

export interface RelayPublicDay {
  date: string;
  status: 'prepared' | 'committed' | 'open' | 'closed' | 'finalized';
  ruleset: 'relay-1';
  seedHex?: string;
  seedCommitment: string;
}

export interface RelayAttemptTicket {
  id: string;
  actorId: string;
  missionDate: string;
  ruleset: 'relay-1';
  issuedAt: number;
  expiresAt: number;
}

export interface RelayRunStatus {
  runId: string;
  status: 'verified';
  missionDate: string;
  ruleset: 'relay-1';
  result: { score: number; completedTicks: number };
  receivedAt: number;
}

const apiBase = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class RelayApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'RelayApiError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchRelayBootstrap(signal?: AbortSignal): Promise<RelayBootstrap> {
  if (!apiBase) return { mode: 'practice', competitive: false, reason: 'relay_api_unconfigured' };
  const response = await fetch(`${apiBase}/relay/api/bootstrap`, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Relay bootstrap unavailable (${response.status}).`);
  const payload = await response.json() as { data?: RelayBootstrap };
  if (!payload.data || (payload.data.mode !== 'practice' && payload.data.mode !== 'competitive')) throw new Error('Relay bootstrap response was invalid.');
  return payload.data;
}

export async function fetchRelayWorld(signal?: AbortSignal): Promise<RelayWorldSnapshot | null> {
  if (!apiBase) return null;
  return parseRelayResponse<RelayWorldSnapshot | null>(await fetch(`${apiBase}/relay/api/world`, { signal, headers: { accept: 'application/json' } }));
}

export async function requestRelayWalletChallenge(input: { actorId: string; address: string; network: 'main' | 'test' }, signal?: AbortSignal): Promise<RelayWalletChallenge> {
  const payload = await postRelay<RelayWalletChallenge>('/relay/api/wallet-bindings/challenge', input, signal);
  return payload;
}

export async function submitRelayWalletBinding(input: RelayWalletBindingRequest, signal?: AbortSignal): Promise<unknown> {
  return postRelay('/relay/api/wallet-bindings', input, signal);
}

export async function requestRelayAttempt(input: { actorId: string; missionDate: string; network: 'main' | 'test' }, signal?: AbortSignal): Promise<RelayAttemptTicket> {
  return postRelay('/relay/api/attempts', input, signal);
}

export async function fetchRelayDay(missionDate: string, signal?: AbortSignal): Promise<RelayPublicDay> {
  if (!apiBase) throw new RelayApiError('relay_api_unconfigured', 0);
  return parseRelayResponse<RelayPublicDay>(await fetch(`${apiBase}/relay/api/days/${encodeURIComponent(missionDate)}`, { signal, headers: { accept: 'application/json' } }));
}

export async function submitRelayRun(payload: string, signal?: AbortSignal): Promise<RelayRunStatus | { verification: 'verified'; result: RelayRunStatus['result'] }> {
  if (!apiBase) throw new RelayApiError('relay_api_unconfigured', 0);
  const response = await fetch(`${apiBase}/relay/api/runs`, { method: 'POST', signal, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: payload });
  return parseRelayResponse(response);
}

export async function findRelayRun(runId: string, signal?: AbortSignal): Promise<RelayRunStatus | null> {
  if (!apiBase) return null;
  const response = await fetch(`${apiBase}/relay/api/runs/${encodeURIComponent(runId)}`, { signal, headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  return parseRelayResponse(response);
}

async function postRelay<T = unknown>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!apiBase) throw new RelayApiError('relay_api_unconfigured', 0);
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', signal, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return parseRelayResponse<T>(response);
}

async function parseRelayResponse<T = unknown>(response: Response): Promise<T> {
  type RelayResponse = { ok?: boolean; data?: T; error?: string };
  let payload: RelayResponse | null = null;
  try { payload = await response.json() as RelayResponse; } catch { /* handled as a stable API error below */ }
  if (!response.ok || payload === null || payload.ok !== true || payload.data === undefined) throw new RelayApiError(payload?.error ?? `relay_http_${response.status}`, response.status);
  return payload.data;
}
import type { RelayWalletBindingRequest, RelayWalletChallenge } from './nimiq/binding';
