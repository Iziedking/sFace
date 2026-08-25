import { randomBytes } from 'node:crypto';

import { commitRelaySeed } from '../../shared/relay/commitment';
import { RELAY_RULESET } from '../../shared/relay/ruleset';
import { isIsoUtcDate } from '../../shared/relay/types';
import type { RelayStore, RelaySnapshot } from './store';

export type RelayDayStatus = 'prepared' | 'committed' | 'open' | 'closed' | 'finalized';
export const RELAY_DEFAULT_WORLD_TARGET = 10_000;
export const RELAY_DEFAULT_UNLOCK_THRESHOLDS = Object.freeze([2_500, 5_000, 10_000]);

export interface RelayDayRecord {
  date: string;
  seasonId: string;
  status: RelayDayStatus;
  ruleset: 'relay-1';
  seedHex: string;
  seedCommitment: string;
  preparedAt: number;
  committedAt: number | null;
  openedAt: number | null;
  closedAt: number | null;
  finalizedAt: number | null;
  target: number;
  unlockThresholds: number[];
}

export type RelayPublicDay = Omit<RelayDayRecord, 'seedHex'> & { seedHex?: string };

export class RelayDailyError extends Error {
  readonly code: 'relay_day_invalid_date' | 'relay_day_transition_invalid' | 'relay_day_not_current' | 'relay_day_commitment_mismatch';

  constructor(code: RelayDailyError['code'], message: string) {
    super(message);
    this.name = 'RelayDailyError';
    this.code = code;
  }
}

export interface RelayDailyService {
  load(): Promise<void>;
  prepare(date: string): Promise<RelayDayRecord>;
  commit(date: string): Promise<RelayDayRecord>;
  open(date: string): Promise<RelayDayRecord>;
  close(date: string): Promise<RelayDayRecord>;
  finalize(date: string): Promise<RelayDayRecord>;
  getDay(date: string): RelayDayRecord | null;
  publicDay(date: string): RelayPublicDay | null;
}

export function createRelayDailyService(options: { store: RelayStore; seasonId?: string; now?: () => Date }): RelayDailyService {
  const now = options.now ?? (() => new Date());
  let snapshot: RelaySnapshot | null = null;

  const ensure = async (): Promise<RelaySnapshot> => {
    if (!snapshot) snapshot = await options.store.load();
    return snapshot;
  };
  const dateCheck = (date: string): void => {
    if (!isIsoUtcDate(date)) throw new RelayDailyError('relay_day_invalid_date', 'Relay day date is invalid.');
  };
  const transition = async (date: string, status: RelayDayStatus, patch: Partial<RelayDayRecord>): Promise<RelayDayRecord> => {
    const current = await ensure();
    const existing = current.days[date] as unknown as RelayDayRecord | undefined;
    if (!existing) throw new RelayDailyError('relay_day_transition_invalid', 'Relay day does not exist.');
    const nextDay = { ...existing, ...patch, status };
    const next = structuredClone(current);
    next.days[date] = nextDay as unknown as Record<string, unknown>;
    await options.store.commit(`day.${status}`, next);
    snapshot = next;
    return nextDay;
  };

  return {
    async load() { snapshot = await options.store.load(); },
    async prepare(date) {
      dateCheck(date);
      const current = await ensure();
      if (current.days[date]) throw new RelayDailyError('relay_day_transition_invalid', 'Relay day is already prepared.');
      const seedHex = randomBytes(32).toString('hex');
      const day: RelayDayRecord = {
        date,
        seasonId: options.seasonId ?? 'season-0',
        status: 'prepared',
        ruleset: RELAY_RULESET.version,
        seedHex,
        seedCommitment: await commitRelaySeed({ ruleset: RELAY_RULESET.version, missionDate: date, seedHex }),
        preparedAt: now().getTime(),
        committedAt: null,
        openedAt: null,
        closedAt: null,
        finalizedAt: null,
        target: RELAY_DEFAULT_WORLD_TARGET,
        unlockThresholds: [...RELAY_DEFAULT_UNLOCK_THRESHOLDS],
      };
      const next = structuredClone(current);
      next.days[date] = day as unknown as Record<string, unknown>;
      await options.store.commit('day.prepared', next);
      snapshot = next;
      return day;
    },
    async commit(date) {
      dateCheck(date);
      const day = this.getDay(date);
      if (!day || day.status !== 'prepared') throw new RelayDailyError('relay_day_transition_invalid', 'Only prepared days can be committed.');
      return transition(date, 'committed', { committedAt: now().getTime() });
    },
    async open(date) {
      dateCheck(date);
      if (date !== now().toISOString().slice(0, 10)) throw new RelayDailyError('relay_day_not_current', 'Only the current UTC day can open.');
      const day = this.getDay(date);
      if (!day || day.status !== 'committed') throw new RelayDailyError('relay_day_transition_invalid', 'Only committed days can open.');
      const commitment = await commitRelaySeed({ ruleset: day.ruleset, missionDate: day.date, seedHex: day.seedHex });
      if (commitment !== day.seedCommitment) throw new RelayDailyError('relay_day_commitment_mismatch', 'Stored seed commitment does not match the seed.');
      return transition(date, 'open', { openedAt: now().getTime() });
    },
    async close(date) {
      dateCheck(date);
      const day = this.getDay(date);
      if (!day || day.status !== 'open') throw new RelayDailyError('relay_day_transition_invalid', 'Only open days can close.');
      return transition(date, 'closed', { closedAt: now().getTime() });
    },
    async finalize(date) {
      dateCheck(date);
      const day = this.getDay(date);
      if (!day || day.status !== 'closed') throw new RelayDailyError('relay_day_transition_invalid', 'Only closed days can finalize.');
      return transition(date, 'finalized', { finalizedAt: now().getTime() });
    },
    getDay(date) {
      const value = snapshot?.days[date] as unknown as RelayDayRecord | undefined;
      return value ? structuredClone(value) : null;
    },
    publicDay(date) {
      const value = this.getDay(date);
      if (!value) return null;
      if (value.status === 'open') return value;
      const { seedHex: _seedHex, ...publicValue } = value;
      return publicValue;
    },
  };
}
