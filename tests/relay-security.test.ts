import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { apiSecurityHeaders } from '../server/security-headers';
import { installHttpBoundary } from '../server/http-boundary';
import { assertSingleRelayWriter } from '../server/relay/writer';

const servers: Array<ReturnType<ReturnType<typeof express>['listen']>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('Relay security boundaries', () => {
  it('refuses a multi-writer Relay configuration and defaults to one writer', () => {
    expect(assertSingleRelayWriter({})).toBe(1);
    expect(() => assertSingleRelayWriter({ RELAY_WRITER_COUNT: '2' })).toThrow(/one writer/);
  });

  it('publishes restrictive API security headers', () => {
    const headers = apiSecurityHeaders();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['permissions-policy']).toContain('camera=()');
  });

  it('rejects oversized JSON before a route receives it', async () => {
    const app = express();
    installHttpBoundary(app, { allowedOrigins: [], production: false, trustProxy: false, networkHeader: 'x-nimiq-network' });
    let reached = false;
    app.post('/relay', (_req, res) => { reached = true; res.json({ ok: true }); });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer) => {
      const nextServer = app.listen(0, () => resolveServer(nextServer));
      servers.push(nextServer);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
    const response = await fetch(`http://127.0.0.1:${address.port}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trace: 'x'.repeat(20_000) }) });
    expect(response.status).toBe(413);
    expect(reached).toBe(false);
  });
});
