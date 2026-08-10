export type AdminLogLevel = 'info' | 'warn' | 'error';

export interface AdminLogEntry {
  time: number;
  level: AdminLogLevel;
  subsystem: string;
  event: string;
  message: string;
  context?: Record<string, unknown>;
}

const REDACTED_KEYS = /token|secret|authorization|password|private.?key|signature/i;

export function redactContext(value: unknown, key = ''): unknown {
  if (REDACTED_KEYS.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactContext(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactContext(item, name)]));
  }
  return value;
}

export class AdminLogBuffer {
  private readonly entries: AdminLogEntry[] = [];

  constructor(
    private readonly retentionMs: number,
    private readonly maxEntries = 5_000,
  ) {}

  add(entry: AdminLogEntry): void {
    this.entries.push({
      ...entry,
      context: entry.context ? redactContext(entry.context) as Record<string, unknown> : undefined,
    });
    this.prune(entry.time);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
  }

  list(now = Date.now(), limit = 200): AdminLogEntry[] {
    this.prune(now);
    return this.entries.slice(-Math.max(1, Math.min(limit, 1_000))).reverse();
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;
    while (this.entries[0] && this.entries[0].time < cutoff) this.entries.shift();
  }
}

export const adminLogs = new AdminLogBuffer(14 * 86_400_000);
