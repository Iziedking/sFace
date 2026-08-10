import { describe, expect, it } from 'vitest';

import { adminRecord, ADMIN_RECORD_KINDS } from '../server/admin/records';

describe('admin read-only records', () => {
  it('returns only registered record kinds', () => {
    const sources = { profiles: () => ['p'], scores: () => ['s'] };
    expect(adminRecord('profiles', sources)).toEqual({ ok: true, kind: 'profiles', records: ['p'] });
    expect(adminRecord('unknown', sources)).toEqual({ ok: false, error: 'unknown_record_kind' });
    expect(ADMIN_RECORD_KINDS).toContain('profiles');
  });
});
