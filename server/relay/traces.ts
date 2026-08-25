import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_MAX_TRACE_BYTES = 262_144;

export class RelayTraceError extends Error {
  readonly code: 'relay_trace_hash_mismatch' | 'relay_trace_conflict' | 'relay_trace_too_large';

  constructor(code: RelayTraceError['code'], message: string) {
    super(message);
    this.name = 'RelayTraceError';
    this.code = code;
  }
}

export function hashRelayTraceBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface RelayTraceStore {
  pathFor(hash: string): string;
  has(hash: string): Promise<boolean>;
  read(hash: string): Promise<Uint8Array>;
  save(hash: string, bytes: Uint8Array): Promise<void>;
}

export function createRelayTraceStore(options: { directory: string; maxBytes?: number }): RelayTraceStore {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_TRACE_BYTES;
  const pathFor = (hash: string): string => join(options.directory, `${hash}.trace`);

  return {
    pathFor,
    async has(hash) {
      try {
        await access(pathFor(hash));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    async read(hash) {
      return new Uint8Array(await readFile(pathFor(hash)));
    },
    async save(hash, bytes) {
      if (bytes.byteLength > maxBytes) throw new RelayTraceError('relay_trace_too_large', 'Relay trace exceeds the permitted size.');
      if (!/^[0-9a-f]{64}$/.test(hash) || hashRelayTraceBytes(bytes) !== hash) {
        throw new RelayTraceError('relay_trace_hash_mismatch', 'Relay trace content does not match its SHA-256 path.');
      }

      const target = pathFor(hash);
      try {
        const existing = await readFile(target);
        if (existing.length === bytes.byteLength && existing.every((value, index) => value === bytes[index])) return;
        throw new RelayTraceError('relay_trace_conflict', 'Different bytes already exist under this trace hash.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      await mkdir(options.directory, { recursive: true });
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    },
  };
}
