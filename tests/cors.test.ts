import { describe, expect, it } from 'vitest';
import express from 'express';

import { corsDecision, parseAllowedOrigins } from '../server/cors';
import { allowedRequestHeaders, installHttpBoundary } from '../server/http-boundary';

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

  it('allows the bearer header used by the admin panel', () => {
    expect(allowedRequestHeaders('x-sface-network')).toContain('authorization');
  });

  it('allows the admin PATCH preflight only from an allowed origin', async () => {
    const app = express();
    installHttpBoundary(app, {
      allowedOrigins: ['https://sface.game'],
      production: true,
      trustProxy: false,
      networkHeader: 'x-sface-network',
    });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer) => {
      const nextServer = app.listen(0, () => resolveServer(nextServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const url = `http://127.0.0.1:${address.port}/admin/api/config`;
      const allowed = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://sface.game',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'authorization, content-type',
        },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-methods')).toContain('PATCH');

      const denied = await fetch(url, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'PATCH',
        },
      });
      expect(denied.status).toBe(403);
    } finally {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    }
  });
});
