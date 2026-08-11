import { afterEach, describe, expect, it } from 'vitest';

import { TOUR_MAX_SHOWS, clearSnapshot, clearTourDone, countTourShow, readCleared, readRoomSeen, readSnapshot, readStage, readTourDone, writeCleared, writeRoomSeen, writeSnapshot, writeStage, writeTourDone } from '../src/browser-state';

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

  /*
   * The tour flag, which is the whole rule deciding who gets taught.
   *
   * One flag serves both entrances: a first practice run and a first real run
   * by somebody who skipped practice. That is what stops the two paths having
   * to know about each other, so it is worth pinning that it behaves as one.
   */
  it('shows the tour once and then not again', () => {
    const local = new StorageMock();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });

    expect(readTourDone()).toBe(false);
    countTourShow();
    expect(readTourDone()).toBe(false);

    writeTourDone();
    expect(readTourDone()).toBe(true);
  });

  it('gives up on a tour nobody ever finishes', () => {
    const local = new StorageMock();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });

    // Quitting mid-tour leaves it unsettled, so it comes back. The cap is what
    // keeps "unsettled" from meaning a tutorial that will not go away.
    for (let show = 0; show < TOUR_MAX_SHOWS; show++) {
      expect(readTourDone()).toBe(false);
      countTourShow();
    }

    expect(readTourDone()).toBe(true);
  });

  it('arms the tour again when settings asks for it', () => {
    const local = new StorageMock();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });

    writeTourDone();
    countTourShow();
    countTourShow();
    countTourShow();
    expect(readTourDone()).toBe(true);

    // Both keys, or the count alone would keep it retired.
    clearTourDone();
    expect(readTourDone()).toBe(false);
  });

  it('fails soft when browser storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    expect(readStage()).toBe(1);
    expect(readCleared()).toBe(0);
    expect(readRoomSeen()).toBe(0);
    expect(readSnapshot()).toBeNull();
    /*
     * And a blocked store teaches the controls rather than skipping them.
     *
     * Private mode, an embedded WebView with storage off. Being shown the tour
     * twice is a far smaller failure than a first-time player being handed a
     * ship, a gun and no statement anywhere about which key does what.
     */
    expect(readTourDone()).toBe(false);
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

