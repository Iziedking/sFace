import { describe, expect, it } from 'vitest';

import { isAuditEvent } from '../server/admin/audit';

describe('admin audit history', () => {
  it('recognises operator actions only', () => {
    expect(isAuditEvent('login_success')).toBe(true);
    expect(isAuditEvent('login_failed')).toBe(true);
    expect(isAuditEvent('login_ip_denied')).toBe(true);
    expect(isAuditEvent('backup_created')).toBe(true);
    expect(isAuditEvent('diagnostics_exported')).toBe(true);
    expect(isAuditEvent('records_read')).toBe(true);
    expect(isAuditEvent('oracle_request')).toBe(false);
  });
});
