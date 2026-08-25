import { describe, expect, it } from 'vitest';

import {
  canonicalRelayTrace,
  canonicalRelayTraceBytes,
  decodeRelayTraceCompressed,
  encodeRelayTraceCompressed,
  hashRelayTrace,
} from '../shared/relay/trace';
import type { RelayTrace } from '../shared/relay/types';

const base: Omit<RelayTrace, 'segments'> = {
  version: 1,
  ruleset: 'relay-1',
  missionDate: '2026-08-24',
  seedCommitment: 'a'.repeat(64),
  ticketId: 'ticket-1',
};

function trace(segments: RelayTrace['segments']): RelayTrace {
  return { ...base, segments };
}

describe('Relay trace canonicalization', () => {
  it('merges adjacent equal inputs and covers every tick exactly once', () => {
    const canonical = canonicalRelayTrace(trace([
      { startTick: 0, tickCount: 10, steerX: 0, flags: 0 },
      { startTick: 10, tickCount: 10, steerX: 0, flags: 0 },
      { startTick: 20, tickCount: 1_330, steerX: 1, flags: 0 },
    ]));
    expect(canonical.segments).toEqual([
      { startTick: 0, tickCount: 20, steerX: 0, flags: 0 },
      { startTick: 20, tickCount: 1_330, steerX: 1, flags: 0 },
    ]);
    expect(canonicalRelayTraceBytes(canonical)).toEqual(canonicalRelayTraceBytes(canonicalRelayTrace(canonical)));
  });

  it('hashes canonical uncompressed bytes and round-trips the bounded transport codec', async () => {
    const original = trace([{ startTick: 0, tickCount: 1_350, steerX: 4, flags: 0 }]);
    const canonical = canonicalRelayTrace(original);
    const compressed = encodeRelayTraceCompressed(canonical);
    const decoded = decodeRelayTraceCompressed(compressed, base);
    expect(decoded).toEqual(canonical);
    expect(compressed.byteLength).toBeLessThan(65_536);
    expect(await hashRelayTrace(original)).toBe(await hashRelayTrace(canonical));
  });

  it('rejects trailing transport bytes and oversized compressed input', () => {
    const encoded = encodeRelayTraceCompressed(canonicalRelayTrace(trace([
      { startTick: 0, tickCount: 1_350, steerX: 0, flags: 0 },
    ])));
    expect(() => decodeRelayTraceCompressed(Uint8Array.from([...encoded, 0]), base)).toThrow(/trailing|length/i);
    expect(() => decodeRelayTraceCompressed(new Uint8Array(65_537), base)).toThrow(/size/i);
  });
});
