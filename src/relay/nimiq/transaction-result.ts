export type RelayTransactionResult =
  | { kind: 'ambiguous'; value: string }
  | { kind: 'error'; type: string; message: string }
  | { kind: 'empty' }
  | { kind: 'object'; value: Record<string, unknown> };

export function normalizeRelayTransactionResult(value: unknown): RelayTransactionResult {
  if (value === null || value === undefined) return { kind: 'empty' };
  if (typeof value === 'string') return { kind: 'ambiguous', value };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (candidate.error && typeof candidate.error === 'object') {
      const error = candidate.error as { type?: unknown; message?: unknown };
      return { kind: 'error', type: typeof error.type === 'string' ? error.type : 'provider_error', message: typeof error.message === 'string' ? error.message : 'The wallet returned an error.' };
    }
    return { kind: 'object', value: candidate };
  }
  return { kind: 'empty' };
}
