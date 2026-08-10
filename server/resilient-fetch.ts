type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type Sleep = (milliseconds: number) => Promise<void>;

export interface ResilientFetchOptions {
  fetcher?: Fetcher;
  sleep?: Sleep;
  now?: () => number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

export class CircuitOpenError extends Error {
  constructor(origin: string) {
    super(`External request circuit is open for ${origin}.`);
    this.name = 'CircuitOpenError';
  }
}

export class ResilientFetch {
  private readonly fetcher: Fetcher;
  private readonly sleep: Sleep;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly circuits = new Map<string, CircuitState>();

  constructor(options: ResilientFetchOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.retries = options.retries ?? 1;
    this.backoffMs = options.backoffMs ?? 250;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  async get(url: string): Promise<Response> {
    const origin = new URL(url).origin;
    const circuit = this.circuits.get(origin) ?? { failures: 0, openUntil: 0 };
    const now = this.now();
    if (circuit.openUntil > now) throw new CircuitOpenError(origin);
    if (circuit.openUntil > 0) {
      circuit.failures = 0;
      circuit.openUntil = 0;
    }

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const response = await this.fetcher(url, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (!isTransient(response.status)) {
          if (response.ok) this.circuits.delete(origin);
          return response;
        }
        if (attempt < this.retries) {
          await this.sleep(this.backoffMs * 2 ** attempt);
          continue;
        }
        this.recordFailure(origin, circuit);
        return response;
      } catch (error) {
        if (attempt < this.retries) {
          await this.sleep(this.backoffMs * 2 ** attempt);
          continue;
        }
        this.recordFailure(origin, circuit);
        throw error;
      }
    }

    throw new Error('External request retry loop ended unexpectedly.');
  }

  private recordFailure(origin: string, circuit: CircuitState): void {
    circuit.failures += 1;
    if (circuit.failures >= this.failureThreshold) {
      circuit.openUntil = this.now() + this.cooldownMs;
    }
    this.circuits.set(origin, circuit);
  }
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}
