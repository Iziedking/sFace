import { describe, expect, it } from 'vitest';

import { isSupportedAdminOperation } from '../server/admin/operations-routes';

describe('admin operation authorization', () => {
  it('allows only registered mutation families', () => {
    expect(isSupportedAdminOperation('backup.create')).toBe(true);
    expect(isSupportedAdminOperation('diagnostics.export')).toBe(true);
    expect(isSupportedAdminOperation('restart.request')).toBe(true);
    expect(isSupportedAdminOperation('secret.replace:ADMIN_TOKEN')).toBe(true);
    expect(isSupportedAdminOperation('config.change:TRUST_PROXY')).toBe(true);
  });

  it('refuses unknown and empty operations', () => {
    expect(isSupportedAdminOperation('')).toBe(false);
    expect(isSupportedAdminOperation('restart')).toBe(false);
    expect(isSupportedAdminOperation('config.read:ADMIN_TOKEN')).toBe(false);
  });
});
