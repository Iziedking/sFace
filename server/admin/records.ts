export const ADMIN_RECORD_KINDS = [
  'profiles', 'scores', 'clans', 'contests', 'challenges', 'tips', 'ghosts', 'chat', 'signals',
] as const;

export type AdminRecordKind = typeof ADMIN_RECORD_KINDS[number];
export type AdminRecordSources = Partial<Record<AdminRecordKind, () => unknown>>;

export type AdminRecordResult =
  | { ok: true; kind: AdminRecordKind; records: unknown }
  | { ok: false; error: 'unknown_record_kind' | 'record_source_unavailable' };

export function adminRecord(kind: string, sources: AdminRecordSources): AdminRecordResult {
  if (!ADMIN_RECORD_KINDS.includes(kind as AdminRecordKind)) {
    return { ok: false, error: 'unknown_record_kind' };
  }
  const typedKind = kind as AdminRecordKind;
  const source = sources[typedKind];
  if (!source) return { ok: false, error: 'record_source_unavailable' };
  return { ok: true, kind: typedKind, records: source() };
}
