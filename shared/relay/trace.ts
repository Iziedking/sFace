import {
  RELAY_MAX_COMPRESSED_TRACE_BYTES,
  RELAY_MAX_EXPANDED_TRACE_BYTES,
  RELAY_MAX_SEGMENTS,
  RELAY_STEER_MAX,
  RELAY_STEER_MIN,
} from './constants';
import { assertRelayTrace, type RelayInputSegment, type RelayTrace } from './types';

const MAGIC = [0x52, 0x4c, 0x01] as const;
const SEGMENT_BYTES = 8;

export function canonicalRelayTrace(trace: RelayTrace): RelayTrace {
  assertRelayTrace(trace);
  const segments: RelayInputSegment[] = [];
  for (const segment of trace.segments) {
    const previous = segments[segments.length - 1];
    if (previous && previous.steerX === segment.steerX && previous.flags === segment.flags) {
      previous.tickCount += segment.tickCount;
      continue;
    }
    segments.push({ ...segment });
  }
  return { ...trace, segments };
}

export function canonicalRelayTraceBytes(trace: RelayTrace): Uint8Array {
  const canonical = canonicalRelayTrace(trace);
  const wire = {
    version: canonical.version,
    ruleset: canonical.ruleset,
    missionDate: canonical.missionDate,
    seedCommitment: canonical.seedCommitment,
    ticketId: canonical.ticketId,
    segments: canonical.segments.map((segment) => ({
      startTick: segment.startTick,
      tickCount: segment.tickCount,
      steerX: segment.steerX,
      flags: segment.flags,
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  if (bytes.byteLength > RELAY_MAX_EXPANDED_TRACE_BYTES) throw new Error('Expanded trace exceeds the permitted size.');
  return bytes;
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function hashRelayTrace(trace: RelayTrace): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copyBytes(canonicalRelayTraceBytes(trace)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function encodeRelayTraceCompressed(trace: RelayTrace): Uint8Array {
  const canonical = canonicalRelayTrace(trace);
  if (canonical.segments.length > 0xffff) throw new Error('Trace has too many segments.');
  const bytes = new Uint8Array(5 + canonical.segments.length * SEGMENT_BYTES);
  bytes.set(MAGIC, 0);
  bytes[3] = canonical.segments.length >>> 8;
  bytes[4] = canonical.segments.length & 0xff;
  const view = new DataView(copyBytes(bytes));
  let offset = 5;
  for (const segment of canonical.segments) {
    view.setUint16(offset, segment.startTick);
    view.setUint16(offset + 2, segment.tickCount);
    view.setInt16(offset + 4, segment.steerX);
    view.setUint16(offset + 6, segment.flags);
    offset += SEGMENT_BYTES;
  }
  bytes.set(new Uint8Array(view.buffer));
  if (bytes.byteLength > RELAY_MAX_COMPRESSED_TRACE_BYTES) throw new Error('Compressed trace exceeds the permitted size.');
  return bytes;
}

export function decodeRelayTraceCompressed(
  bytes: Uint8Array,
  metadata: Omit<RelayTrace, 'segments'>,
): RelayTrace {
  if (bytes.byteLength > RELAY_MAX_COMPRESSED_TRACE_BYTES) throw new Error('Compressed trace exceeds the permitted size.');
  if (bytes.byteLength < 5 || !MAGIC.every((value, index) => bytes[index] === value)) throw new Error('Compressed trace header is invalid.');
  const count = (bytes[3]! << 8) | bytes[4]!;
  if (count === 0 || count > RELAY_MAX_SEGMENTS) throw new Error('Compressed trace segment count is invalid.');
  const expectedLength = 5 + count * SEGMENT_BYTES;
  if (bytes.byteLength !== expectedLength) throw new Error('Compressed trace has trailing or truncated bytes.');
  const view = new DataView(copyBytes(bytes));
  const segments: RelayInputSegment[] = [];
  let offset = 5;
  for (let index = 0; index < count; index += 1) {
    const segment = {
      startTick: view.getUint16(offset),
      tickCount: view.getUint16(offset + 2),
      steerX: view.getInt16(offset + 4),
      flags: view.getUint16(offset + 6),
    };
    if (segment.steerX < RELAY_STEER_MIN || segment.steerX > RELAY_STEER_MAX) throw new Error('Compressed trace steerX is invalid.');
    segments.push(segment);
    offset += SEGMENT_BYTES;
  }
  const trace: RelayTrace = { ...metadata, segments };
  assertRelayTrace(trace);
  canonicalRelayTraceBytes(trace);
  return canonicalRelayTrace(trace);
}
