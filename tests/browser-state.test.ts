import { afterEach, describe, expect, it } from 'vitest';

import { clearSnapshot, readCleared, readRoomSeen, readSnapshot, readStage, writeCleared, writeRoomSeen, writeSnapshot, writeStage } from '../src/browser-state';

const originalLocal = globalThis.localStorage;
const originalSession = globalThis.sessionStorage;

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocal });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: originalSession });
});

describe('browser state boundary', () => {
  it('clamps editable stage storage and keeps progress monotonic', () => {
    const local = new StorageMock();
    local.setItem('sface.stage', '999');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
    expect(readStage()).toBe(7);
    writeCleared(4);
    writeCleared(2);
    expect(readCleared()).toBe(4);
    writeStage(3);
    expect(readStage()).toBe(3);
    writeRoomSeen(123);
    expect(readRoomSeen()).toBe(123);
  });

  it('round-trips and clears a session snapshot', () => {
    const session = new StorageMock();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
    const snapshot = { version: 1, stage: 2 } as never;
    writeSnapshot(snapshot);
    expect(readSnapshot()).toEqual(snapshot);
    clearSnapshot();
    expect(readSnapshot()).toBeNull();
  });

  it('fails soft when browser storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    expect(readStage()).toBe(1);
    expect(readCleared()).toBe(0);
    expect(readRoomSeen()).toBe(0);
    expect(readSnapshot()).toBeNull();
  });
});

class StorageMock implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

