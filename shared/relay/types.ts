import {
  RELAY_MAX_SEGMENTS,
  RELAY_RUN_TICKS,
  RELAY_STEER_MAX,
  RELAY_STEER_MIN,
} from './constants';

export type RelayRulesetVersion = 'relay-1';
export type RelayTraceVersion = 1;

export interface RelayInputSegment {
  startTick: number;
  tickCount: number;
  steerX: number;
  flags: number;
}

export interface RelayTrace {
  version: RelayTraceVersion;
  ruleset: RelayRulesetVersion;
  missionDate: string;
  seedCommitment: string;
  ticketId: string;
  segments: RelayInputSegment[];
}

export interface RelayResult {
  score: number;
  bankedNodes: number;
  damageTaken: number;
  bestChain: number;
  integrityRemaining: number;
  completedTicks: number;
  repairUnits: number;
}

export interface RelayRunRecord {
  id: string;
  actorId: string;
  ticketId: string;
  walletAddress: string;
  missionDate: string;
  ruleset: RelayRulesetVersion;
  seedCommitment: string;
  traceHash: string;
  result: RelayResult;
  verification: 'verified';
  receivedAt: number;
}

export interface RelayRuleset {
  version: RelayRulesetVersion;
  tickRate: 30;
  runTicks: 1_350;
  fixedScale: 1_000;
  courseWidth: number;
  courseHeight: number;
  podWidth: number;
  podHeight: number;
  forwardSpeedFixed: number;
  steerSpeedFixed: number;
  initialIntegrity: number;
  nodeCapacity: number;
  collisionCooldownTicks: number;
  baseNodeScore: number;
  routeRiskBonus: number;
  chainBonus: number;
  integrityBonus: number;
  noDamageBonus: number;
  repairScoreDivisor: number;
  repairUnitCap: 100;
}

export type RelayErrorCode =
  | 'invalid_trace'
  | 'invalid_result'
  | 'legacy_experience_archived'
  | 'service_unavailable';

export interface RelayErrorEnvelope {
  ok: false;
  error: {
    code: RelayErrorCode;
    message: string;
  };
}

export interface RelaySuccessEnvelope<T> {
  ok: true;
  data: T;
}

export type RelayEnvelope<T> = RelaySuccessEnvelope<T> | RelayErrorEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }
}

function assertSafeNonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
}

export function isIsoUtcDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    date.getUTCFullYear() === Number(value.slice(0, 4)) &&
    date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getUTCDate() === Number(value.slice(8, 10))
  );
}

export function isSeedCommitment(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function assertRelayTrace(value: unknown): asserts value is RelayTrace {
  if (!isRecord(value)) throw new Error('Trace must be an object.');
  if (value.version !== 1) throw new Error('Trace version is unsupported.');
  if (value.ruleset !== 'relay-1') throw new Error('Trace ruleset is unsupported.');
  if (!isIsoUtcDate(value.missionDate)) throw new Error('Trace missionDate must be an ISO UTC date.');
  if (!isSeedCommitment(value.seedCommitment)) throw new Error('Trace seed commitment must be lowercase hexadecimal.');
  if (typeof value.ticketId !== 'string' || value.ticketId.length === 0 || value.ticketId.length > 128) {
    throw new Error('Trace ticketId is invalid.');
  }
  if (!Array.isArray(value.segments)) throw new Error('Trace segments must be an array.');
  if (value.segments.length === 0 || value.segments.length > RELAY_MAX_SEGMENTS) {
    throw new Error('Trace segments exceed the permitted limit.');
  }

  let expectedStartTick = 0;
  for (const segment of value.segments) {
    if (!isRecord(segment)) throw new Error('Trace segment must be an object.');
    assertInteger(segment.startTick, 'startTick');
    assertInteger(segment.tickCount, 'tickCount');
    assertInteger(segment.steerX, 'steerX');
    assertInteger(segment.flags, 'flags');
    if (segment.startTick !== expectedStartTick || segment.tickCount <= 0) {
      throw new Error('Trace segments must have exact contiguous coverage.');
    }
    if (segment.steerX < RELAY_STEER_MIN || segment.steerX > RELAY_STEER_MAX) {
      throw new Error('steerX is outside the permitted range.');
    }
    if (segment.flags !== 0) throw new Error('Trace flags contain reserved bits.');
    expectedStartTick += segment.tickCount;
  }
  if (expectedStartTick !== RELAY_RUN_TICKS) {
    throw new Error('Trace segments must have exact contiguous coverage.');
  }
}

export function assertRelayResult(value: unknown): asserts value is RelayResult {
  if (!isRecord(value)) throw new Error('Result must be an object.');
  const fields: Array<keyof RelayResult> = [
    'score',
    'bankedNodes',
    'damageTaken',
    'bestChain',
    'integrityRemaining',
    'completedTicks',
    'repairUnits',
  ];
  for (const field of fields) assertSafeNonNegativeInteger(value[field], field);
  const completedTicks = value.completedTicks;
  if (typeof completedTicks === 'number' && completedTicks > RELAY_RUN_TICKS) {
    throw new Error('completedTicks exceeds the run length.');
  }
}
