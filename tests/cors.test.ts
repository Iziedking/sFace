import { describe, expect, it } from 'vitest';

import { corsDecision, parseAllowedOrigins } from '../server/cors';

describe('production CORS policy', () => {
  it('requires an explicit production allowlist', () => {
    expect(() => parseAllowedOrigins('', true)).toThrow('ALLOWED_ORIGINS');
  });

  it('keeps local development usable when the allowlist is empty', () => {
    expect(parseAllowedOrigins('', false)).toEqual([]);
    expect(corsDecision('http://localhost:5173', [], false)).toEqual({ allowed: true, header: '*' });
  });

  it('refuses an unknown browser origin', () => {
    expect(corsDecision('https://evil.example', ['https://sface.game'], true)).toEqual({
      allowed: false,
      header: null,
    });
  });

  it('allows requests without an Origin header', () => {
    expect(corsDecision(undefined, ['https://sface.game'], true)).toEqual({
      allowed: true,
      header: null,
    });
  });
});
