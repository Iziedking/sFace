import { describe, expect, it } from 'vitest';

import { AdminLogBuffer, parseLogLines, redactContext } from '../server/admin/logs';

describe('admin diagnostic logs', () => {
  it('redacts secret-shaped fields recursively', () => {
    expect(redactContext({ token: 'a', nested: { authorization: 'b', safe: 2 } })).toEqual({
      token: '[redacted]',
      nested: { authorization: '[redacted]', safe: 2 },
    });
  });

  it('keeps only entries inside the retention window', () => {
    const logs = new AdminLogBuffer(14 * 86_400_000);
    logs.add({ time: 1, level: 'info', subsystem: 'admin', event: 'old', message: 'old' });
    logs.add({ time: 15 * 86_400_000, level: 'info', subsystem: 'admin', event: 'new', message: 'new' });

    expect(logs.list(15 * 86_400_000).map((entry) => entry.event)).toEqual(['new']);
  });
  it('restores valid JSONL entries and skips malformed lines', () => {
    const entries = parseLogLines('{"time":1,"level":"info","subsystem":"admin","event":"ok","message":"ready"}\nnot-json\n');
    expect(entries.map((entry) => entry.event)).toEqual(['ok']);
  });
  it('filters entries and publishes new ones to subscribers', () => {
    const logs = new AdminLogBuffer(1_000);
    const seen: string[] = [];
    const unsubscribe = logs.subscribe((entry) => seen.push(entry.event));
    logs.add({ time: 10, level: 'warn', subsystem: 'oracle', event: 'slow', message: 'slow' });
    logs.add({ time: 11, level: 'info', subsystem: 'admin', event: 'login', message: 'login' });
    unsubscribe();

    expect(logs.list(11, 20, { level: 'warn', subsystem: 'oracle' }).map((entry) => entry.event)).toEqual(['slow']);
    expect(seen).toEqual(['slow', 'login']);
  });
});
