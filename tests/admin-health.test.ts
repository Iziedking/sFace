import { describe, expect, it } from 'vitest';

import { effectiveHealth } from '../server/admin/health';

describe('effective health assembly', () => {
  it('marks persistence as the required health gate', () => {
    const result = effectiveHealth({
      persistence: { status: 'degraded', lastError: 'snapshot_write_failed', lastSuccessfulWriteAt: null },
      anchor: false, xOAuth: false, xRead: false, xSense: false, signals: false,
      corsRestricted: true, trustedProxy: true,
    });
    expect(result.persistence.status).toBe('degraded');
    expect(result.capabilities.persistence.enabled).toBe(false);
    expect(result.capabilities.persistence.required).toBe(true);
  });

  it('exposes Relay persistence separately and makes it the required Relay capability', () => {
    const result = effectiveHealth({
      persistence: { status: 'healthy', lastError: null, lastSuccessfulWriteAt: 90 },
      relayPersistence: { status: 'degraded', lastError: 'relay_snapshot_write_failed', lastSuccessfulWriteAt: null },
      anchor: false, xOAuth: false, xRead: false, xSense: false, signals: false,
      corsRestricted: true, trustedProxy: true,
    });

    expect(result.relayPersistence.status).toBe('degraded');
    expect(result.capabilities.relayPersistence).toEqual({ enabled: false, required: true });
  });
});
