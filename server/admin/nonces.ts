import { randomUUID } from 'node:crypto';

interface Nonce { operation: string; expiresAt: number; }

export class OperationNonces {
  private readonly values = new Map<string, Nonce>();

  constructor(private readonly ttlMs: number) {}

  issue(operation: string, now = Date.now()): string {
    this.prune(now);
    const nonce = randomUUID();
    this.values.set(nonce, { operation, expiresAt: now + this.ttlMs });
    return nonce;
  }

  consume(nonce: string, operation: string, now = Date.now()): boolean {
    this.prune(now);
    const value = this.values.get(nonce);
    if (!value || value.operation !== operation || value.expiresAt <= now) return false;
    this.values.delete(nonce);
    return true;
  }

  private prune(now: number): void {
    for (const [nonce, value] of this.values) {
      if (value.expiresAt <= now) this.values.delete(nonce);
    }
  }
}
