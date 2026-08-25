export const ADMIN_RECORD_KINDS = [
  'profiles', 'scores', 'clans', 'contests', 'challenges', 'tips', 'ghosts', 'chat', 'signals',
] as const;

export const ADMIN_RECORD_PAGE_SIZE_MAX = 100;
export const ADMIN_RECORD_RESPONSE_LIMIT_BYTES = 256 * 1024;

export type AdminRecordKind = typeof ADMIN_RECORD_KINDS[number];
export type AdminRecordSources = Partial<Record<AdminRecordKind, () => unknown>>;

export type AdminRecordResult =
  | { ok: true; kind: AdminRecordKind; records: unknown }
  | { ok: false; error: 'unknown_record_kind' | 'record_source_unavailable' };

export type AdminRecordPageResult =
  | {
    ok: true;
    kind: AdminRecordKind;
    page: number;
    pageSize: number;
    totalRecords: number;
    totalPages: number;
    records: unknown[];
  }
  | {
    ok: false;
    error: 'unknown_record_kind' | 'invalid_page' | 'page_size_too_large' | 'record_response_too_large';
  };

function recordList(records: unknown): unknown[] {
  if (records === undefined) return [];
  if (Array.isArray(records)) return records;
  if (records && typeof records === 'object') {
    return Object.entries(records).map(([key, value]) => ({ key, records: value }));
  }
  return [records];
}

export function adminRecord(kind: string, sources: AdminRecordSources): AdminRecordResult {
  if (!ADMIN_RECORD_KINDS.includes(kind as AdminRecordKind)) {
    return { ok: false, error: 'unknown_record_kind' };
  }
  const typedKind = kind as AdminRecordKind;
  const source = sources[typedKind];
  if (!source) return { ok: false, error: 'record_source_unavailable' };
  return { ok: true, kind: typedKind, records: source() };
}

export function paginateAdminRecords(
  kind: string,
  records: unknown,
  page: number,
  pageSize: number,
  responseLimitBytes = ADMIN_RECORD_RESPONSE_LIMIT_BYTES,
): AdminRecordPageResult {
  if (!ADMIN_RECORD_KINDS.includes(kind as AdminRecordKind)) return { ok: false, error: 'unknown_record_kind' };
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    return { ok: false, error: 'invalid_page' };
  }
  if (pageSize > ADMIN_RECORD_PAGE_SIZE_MAX) return { ok: false, error: 'page_size_too_large' };

  const allRecords = recordList(records);
  const totalPages = Math.max(1, Math.ceil(allRecords.length / pageSize));
  const result = {
    ok: true as const,
    kind: kind as AdminRecordKind,
    page,
    pageSize,
    totalRecords: allRecords.length,
    totalPages,
    records: allRecords.slice((page - 1) * pageSize, page * pageSize),
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > responseLimitBytes) {
    return { ok: false, error: 'record_response_too_large' };
  }
  return result;
}
