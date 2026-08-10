import { describe, expect, it } from 'vitest';

import { buildCapabilities } from '../server/capabilities';
import { buildDiagnosticBundle } from '../server/admin/diagnostics';

describe('admin diagnostic export', () => {
  it('contains operational state without secret values', () => {
    const bundle = buildDiagnosticBundle({
      generatedAt: 100,
      commit: 'abc',
      persistence: { status: 'healthy', lastError: null, lastSuccessfulWriteAt: 90 },
      capabilities: buildCapabilities({ persistence: true, anchor: false, xOAuth: false, xRead: false, xSense: false, signals: false, corsRestricted: true, trustedProxy: true }),
      config: [{ key: 'ADMIN_TOKEN', configured: true, secret: true, restartRequired: true }],
      logs: [{ time: 99, level: 'info', subsystem: 'admin', event: 'login', message: 'ok' }],
      rateLimitBuckets: 4,
    });

    expect(bundle.schema).toBe('sface.admin-diagnostics.v1');
    expect(bundle.rateLimitBuckets).toBe(4);
    expect(JSON.stringify(bundle)).not.toContain('ADMIN_TOKEN=');
  });
});
