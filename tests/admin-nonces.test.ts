import { describe, expect, it } from 'vitest';

import { OperationNonces } from '../server/admin/nonces';

describe('admin operation nonces', () => {
  it('consumes a nonce once for the bound operation', () => {
    const nonces = new OperationNonces(60_000);
    const nonce = nonces.issue('backup.create', 100);

    expect(nonces.consume(nonce, 'backup.create', 101)).toBe(true);
    expect(nonces.consume(nonce, 'backup.create', 102)).toBe(false);
  });

  it('refuses another operation and expired nonces', () => {
    const nonces = new OperationNonces(10);
    const first = nonces.issue('backup.create', 100);
    const second = nonces.issue('backup.create', 100);

    expect(nonces.consume(first, 'restart', 101)).toBe(false);
    expect(nonces.consume(second, 'backup.create', 111)).toBe(false);
  });
});
