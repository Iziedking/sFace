import { describe, expect, it, vi } from 'vitest';

import { CircuitOpenError, ResilientFetch } from '../server/resilient-fetch';

function response(status: number): Response {
  return new Response('{}', { status });
}

describe('resilient external requests', () => {
  it('retries one transient response and returns the recovery', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const client = new ResilientFetch({ fetcher, sleep: async () => undefined });

    expect((await client.get('https://oracle.example/data')).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent client error', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(400));
    const client = new ResilientFetch({ fetcher, sleep: async () => undefined });

    expect((await client.get('https://oracle.example/data')).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated upstream failures', async () => {
    let now = 100;
    const fetcher = vi.fn().mockResolvedValue(response(503));
    const client = new ResilientFetch({
      fetcher,
      sleep: async () => undefined,
      now: () => now,
      failureThreshold: 2,
      retries: 0,
      cooldownMs: 1_000,
    });

    await client.get('https://oracle.example/one');
    await client.get('https://oracle.example/two');
    await expect(client.get('https://oracle.example/three')).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetcher).toHaveBeenCalledTimes(2);

    now += 1_001;
    await client.get('https://oracle.example/four');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('passes an abort signal with every request', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200));
    const client = new ResilientFetch({ fetcher, timeoutMs: 25 });

    await client.get('https://oracle.example/data');
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
