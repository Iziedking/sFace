import { describe, expect, it } from 'vitest';

import { buildCapabilities } from '../server/capabilities';

describe('effective capability health', () => {
  it('reports optional subsystems without exposing configuration values', () => {
    const capabilities = buildCapabilities({
      persistence: true,
      anchor: false,
      xOAuth: true,
      xRead: false,
      xSense: true,
      signals: false,
      corsRestricted: true,
      trustedProxy: true,
    });

    expect(capabilities.anchor).toEqual({ enabled: false, required: false });
    expect(capabilities.xOAuth).toEqual({ enabled: true, required: false });
    expect(JSON.stringify(capabilities)).not.toContain('token');
  });

  it('marks persistence as required', () => {
    expect(buildCapabilities({
      persistence: false,
      anchor: false,
      xOAuth: false,
      xRead: false,
      xSense: false,
      signals: false,
      corsRestricted: false,
      trustedProxy: false,
    }).persistence).toEqual({ enabled: false, required: true });
  });
});
