import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
const RETENTION_MS = 14 * 86_400_000;
const LOG_PATH = join(process.env.DATA_DIR ?? join(process.cwd(), '.data'), 'admin-logs.jsonl');

export function redactContext(value: unknown, key = ''): unknown {
  if (REDACTED_KEYS.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => redactContext(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactContext(item, name)]));
  }
  return value;
}

export function parseLogLines(raw: string): AdminLogEntry[] {
  const entries: AdminLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<AdminLogEntry>;
      if (
        typeof value.time === 'number' &&
        ['info', 'warn', 'error'].includes(value.level ?? '') &&
        typeof value.subsystem === 'string' &&
        typeof value.event === 'string' &&
        typeof value.message === 'string'
      ) entries.push(value as AdminLogEntry);
    } catch {
      // A torn final line must not hide every valid event before it.
    }
  }
  return entries;
}

export interface AdminLogFilter { level?: AdminLogLevel; subsystem?: string; event?: string; }

export class AdminLogBuffer {
  private readonly entries: AdminLogEntry[] = [];
  private readonly listeners = new Set<(entry: AdminLogEntry) => void>();

  constructor(private readonly retentionMs: number, private readonly maxEntries = 5_000) {}

  add(entry: AdminLogEntry): AdminLogEntry {
    const safe = {
      ...entry,
      context: entry.context ? redactContext(entry.context) as Record<string, unknown> : undefined,
    };
    this.entries.push(safe);
    this.prune(entry.time);
    for (const listener of this.listeners) listener(safe);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    return safe;
  }

  list(now = Date.now(), limit = 200, filter: AdminLogFilter = {}): AdminLogEntry[] {
    this.prune(now);
    return this.entries.filter((entry) =>
      (!filter.level || entry.level === filter.level) &&
      (!filter.subsystem || entry.subsystem === filter.subsystem) &&
      (!filter.event || entry.event === filter.event),
    ).slice(-Math.max(1, Math.min(limit, 1_000))).reverse();
  }

  subscribe(listener: (entry: AdminLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  chronological(now = Date.now()): AdminLogEntry[] {
    this.prune(now);
    return [...this.entries];
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs;
    while (this.entries[0] && this.entries[0].time < cutoff) this.entries.shift();
  }
}

export const adminLogs = new AdminLogBuffer(RETENTION_MS);

export async function initialiseAdminLogs(): Promise<void> {
  try {
    for (const entry of parseLogLines(await readFile(LOG_PATH, 'utf8'))) adminLogs.add(entry);
    await compactLogFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[sface] admin log restore failed', error);
  }
}

export function recordAdminLog(entry: AdminLogEntry): void {
  const safe = adminLogs.add(entry);
  void persistLine(safe);
}

async function persistLine(entry: AdminLogEntry): Promise<void> {
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('[sface] admin log write failed', error);
  }
}

async function compactLogFile(): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  const temp = `${LOG_PATH}.${process.pid}.tmp`;
  const body = adminLogs.chronological().map((entry) => JSON.stringify(entry)).join('\n');
  await writeFile(temp, body ? `${body}\n` : '', 'utf8');
  await rename(temp, LOG_PATH);
}
