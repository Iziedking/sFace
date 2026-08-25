import { describe, expect, it } from 'vitest';

import { mountSystemRoutes } from '../server/system-routes';

describe('public system health', () => {
  it('uses Relay persistence as the public health gate after cutover', () => {
    let healthHandler: ((request: unknown, response: { status: (code: number) => { json: (body: unknown) => void }; json: (body: unknown) => void }) => void) | undefined;
    const app = {
      get(path: string, ...handlers: Array<(...args: any[]) => void>) {
        if (path === '/health') healthHandler = handlers.at(-1) as typeof healthHandler;
      },
    };
    mountSystemRoutes({
      app: app as never,
      limit: () => (() => undefined) as never,
      health: () => ({
        persistence: { status: 'healthy', lastError: null, lastSuccessfulWriteAt: 1 },
        relayPersistence: { status: 'degraded', lastError: 'relay_snapshot_write_failed', lastSuccessfulWriteAt: null },
        capabilities: {} as never,
      }),
      date: () => '2026-08-24',
      mission: async () => null,
    });
    const result = { statusCode: 200, body: undefined as unknown };
    const response = {
      status(code: number) { result.statusCode = code; return response; },
      json(body: unknown) { result.body = body; },
    };

    healthHandler?.({ get: () => undefined }, response);

    expect(result.statusCode).toBe(503);
    expect(result.body).toMatchObject({ ok: false });
  });
});
