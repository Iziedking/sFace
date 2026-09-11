import type { AtlasUsageDevice, AtlasUsageEventName } from '../../shared/atlas/usage';

/*
 * Client half of usage counting.
 *
 * Three rules, because this is telemetry in a game and telemetry must never be
 * the reason a game stops working:
 *
 * 1. **It cannot throw.** Every path is wrapped. A failed report is dropped.
 * 2. **It cannot block.** Nothing awaits it, and it never sits in an input or
 *    render path.
 * 3. **It cannot be the reason a player waits.** Requests use `keepalive` so a
 *    report in flight does not hold a navigation open.
 *
 * It reuses the session actor id that docs/privacy.md already describes, rather
 * than minting a second identifier. The server hashes it before storing.
 */

export interface AtlasUsageReporter {
  record(name: AtlasUsageEventName, chapter?: number): void;
}

const NOOP: AtlasUsageReporter = { record: () => {} };

export function atlasUsageDevice(): AtlasUsageDevice {
  if (typeof window === 'undefined') return 'desktop';
  // A coarse self-declaration, not a fingerprint: the narrow side of the
  // viewport is all we ask, and all we send is one of two words.
  const narrow = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  return narrow > 0 && narrow <= 540 ? 'phone' : 'desktop';
}

export function createAtlasUsageReporter(options: {
  session: string;
  device?: AtlasUsageDevice;
  endpoint?: string;
  fetcher?: typeof fetch;
  enabled?: boolean;
}): AtlasUsageReporter {
  if (options.enabled === false) return NOOP;
  const fetcher = options.fetcher ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!fetcher || !options.session) return NOOP;
  const endpoint = options.endpoint ?? '/atlas/api/usage';
  const device = options.device ?? atlasUsageDevice();
  // Chapter events repeat as a player moves around; sending every repetition
  // would be noise the server only has to throw away again.
  const sent = new Set<string>();

  return {
    record(name, chapter) {
      const key = `${name}:${chapter ?? ''}`;
      if (sent.has(key)) return;
      sent.add(key);
      try {
        void fetcher(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, session: options.session, device, ...(chapter === undefined ? {} : { chapter }) }),
          keepalive: true,
          credentials: 'same-origin',
        }).catch(() => undefined);
      } catch {
        // Telemetry is never worth an exception in a render or input path.
      }
    },
  };
}
