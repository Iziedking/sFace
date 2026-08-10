import { describe, expect, it } from 'vitest';

import { adminConfig, tokenMatches } from '../server/admin/auth';

describe('admin token seam', () => {
  it('reads token and IP policy without exposing values', () => {
    expect(adminConfig({ ADMIN_TOKEN: ' secret ', ADMIN_ALLOWED_IPS: '127.0.0.1, 10.0.0.1' })).toEqual({
      token: 'secret',
      allowedIps: ['127.0.0.1', '10.0.0.1'],
    });
  });

  it('matches only the exact token', () => {
    expect(tokenMatches('secret', 'secret')).toBe(true);
    expect(tokenMatches('secret2', 'secret')).toBe(false);
    expect(tokenMatches(undefined, 'secret')).toBe(false);
  });
});
