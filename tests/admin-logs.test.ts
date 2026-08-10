import { describe, expect, it } from 'vitest';

import { AdminLogBuffer, redactContext } from '../server/admin/logs';

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
});
