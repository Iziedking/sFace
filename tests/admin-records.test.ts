import { describe, expect, it } from 'vitest';

import { adminRecord, ADMIN_RECORD_KINDS, paginateAdminRecords } from '../server/admin/records';

describe('admin read-only records', () => {
  it('returns only registered record kinds', () => {
    const sources = { profiles: () => ['p'], scores: () => ['s'] };
    expect(adminRecord('profiles', sources)).toEqual({ ok: true, kind: 'profiles', records: ['p'] });
    expect(adminRecord('unknown', sources)).toEqual({ ok: false, error: 'unknown_record_kind' });
    expect(ADMIN_RECORD_KINDS).toContain('profiles');
  });

  it('paginates stable record arrays and rejects oversized pages', () => {
    const records = Array.from({ length: 205 }, (_, index) => ({ id: index }));
    expect(paginateAdminRecords('profiles', records, 2, 100)).toEqual({
      ok: true,
      kind: 'profiles',
      page: 2,
      pageSize: 100,
      totalRecords: 205,
      totalPages: 3,
      records: records.slice(100, 200),
    });
    expect(paginateAdminRecords('profiles', records, 1, 101)).toEqual({
      ok: false,
      error: 'page_size_too_large',
    });
  });
});
