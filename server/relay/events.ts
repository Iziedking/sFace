import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { RelaySnapshot } from './store';

export interface RelayTransitionEvent {
  version: 1;
  sequence: number;
  id: string;
  kind: string;
  at: number;
  snapshot: RelaySnapshot;
}

export type RelayEventErrorCode = 'relay_event_log_corrupt' | 'relay_event_log_truncated';

export class RelayEventError extends Error {
  readonly code: RelayEventErrorCode;

  constructor(code: RelayEventErrorCode, message: string) {
    super(message);
    this.name = 'RelayEventError';
    this.code = code;
  }
}

export async function readRelayEvents(path: string): Promise<RelayTransitionEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const events: RelayTransitionEvent[] = [];
  const lines = raw.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRelayTransitionEvent(parsed)) throw new Error('invalid event shape');
      events.push(parsed);
    } catch {
      const isLastLine = index === lines.length - 1;
      throw new RelayEventError(
        isLastLine ? 'relay_event_log_truncated' : 'relay_event_log_corrupt',
        isLastLine ? 'Relay event log ends with an incomplete transition.' : 'Relay event log contains an invalid transition.',
      );
    }
  }
  return events.sort((left, right) => left.sequence - right.sequence);
}

export async function appendRelayEvent(path: string, event: RelayTransitionEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, 'utf8');
}

function isRelayTransitionEvent(value: unknown): value is RelayTransitionEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<RelayTransitionEvent>;
  return candidate.version === 1 && typeof candidate.sequence === 'number' && Number.isSafeInteger(candidate.sequence) && candidate.sequence > 0
    && typeof candidate.id === 'string' && candidate.id.length > 0
    && typeof candidate.kind === 'string' && candidate.kind.length > 0
    && Number.isSafeInteger(candidate.at)
    && Boolean(candidate.snapshot && typeof candidate.snapshot === 'object');
}
