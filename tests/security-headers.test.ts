import { describe, expect, it } from 'vitest';

import { apiSecurityHeaders } from '../server/security-headers';

describe('API browser security headers', () => {
  it('blocks framing and content sniffing', () => {
    const headers = apiSecurityHeaders();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });
});
