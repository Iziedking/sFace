import { describe, expect, it } from 'vitest';

import { parseSnapshot, persistenceStatusFromError } from '../server/store';

const valid = JSON.stringify({ version: 1, scores: [], challenges: [], mission: null });

describe('snapshot persistence boundary', () => {
  it('accepts the current snapshot version', () => {
    expect(parseSnapshot(valid)).toEqual({ ok: true, value: { version: 1, scores: [], challenges: [], mission: null } });
  });

  it('refuses corrupt JSON instead of treating it as an empty install', () => {
    expect(parseSnapshot('{')).toEqual({ ok: false, error: 'snapshot_corrupt' });
  });

  it('refuses an unsupported snapshot version', () => {
    expect(parseSnapshot(JSON.stringify({ version: 2 }))).toEqual({ ok: false, error: 'snapshot_unsupported' });
  });

  it('treats only a missing file as a fresh install', () => {
    expect(persistenceStatusFromError({ code: 'ENOENT' })).toEqual({ ok: true, value: null });
    expect(persistenceStatusFromError({ code: 'EACCES' })).toEqual({ ok: false, error: 'snapshot_unreadable' });
  });
});
