import { describe, expect, it } from 'vitest';

import { secretFingerprint, validateSecretReplacement } from '../server/admin/secrets';

describe('admin secret replacement', () => {
  it('accepts registered secrets without returning their values', () => {
    expect(validateSecretReplacement('XAI_API_KEY', 'a'.repeat(32))).toEqual({ ok: true, key: 'XAI_API_KEY' });
  });

  it('requires a strong admin token and refuses non-secret keys', () => {
    expect(validateSecretReplacement('ADMIN_TOKEN', 'short')).toEqual({ ok: false, error: 'invalid_secret' });
    expect(validateSecretReplacement('TRUST_PROXY', 'true')).toEqual({ ok: false, error: 'unknown_secret' });
  });

  it('fingerprints without preserving the secret', () => {
    const fingerprint = secretFingerprint('secret-value');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint).not.toContain('secret-value');
  });
});
