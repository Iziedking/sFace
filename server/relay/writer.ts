export function assertSingleRelayWriter(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const raw = env.RELAY_WRITER_COUNT ?? '1';
  if (!/^\d+$/.test(raw)) throw new Error('RELAY_WRITER_COUNT must be a positive integer.');
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('RELAY_WRITER_COUNT must be a positive integer.');
  if (count !== 1) throw new Error('Relay persistence supports exactly one writer; refusing multi-writer startup.');
  return count;
}
