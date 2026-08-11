import { STAGES } from './data/campaign';
import type { RunSnapshot } from './game/snapshot';

const STAGE_KEY = 'sface.stage';
const CLEARED_KEY = 'sface.cleared';
const RUN_KEY = 'sface.run';
const ROOM_SEEN_KEY = 'sface.room.seen';
const TOUR_DONE_KEY = 'sface.tour.done';
const TOUR_SHOWS_KEY = 'sface.tour.shows';

/** The last selected stage, clamped because browser storage is editable. */
export function readStage(): number {
  try {
    const raw = Number(localStorage.getItem(STAGE_KEY));
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(STAGES.length, Math.floor(raw)));
  } catch {
    return 1;
  }
}

export function writeStage(stage: number): void {
  try {
    localStorage.setItem(STAGE_KEY, String(stage));
  } catch {
    // Private mode. The choice simply does not survive the session.
  }
}

/** Campaign progress is local-first so a failed score post cannot lock a cleared stage. */
export function readCleared(): number {
  try {
    const raw = Number(localStorage.getItem(CLEARED_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

export function writeCleared(stage: number): void {
  try {
    if (stage > readCleared()) localStorage.setItem(CLEARED_KEY, String(stage));
  } catch {
    // Blocked storage. The server profile still carries progress when available.
  }
}

/** In-progress runs survive reloads within this tab, but not a new session. */
export function readSnapshot(): RunSnapshot | null {
  try {
    const raw = sessionStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as RunSnapshot) : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(snapshot: RunSnapshot): void {
  try {
    sessionStorage.setItem(RUN_KEY, JSON.stringify(snapshot));
  } catch {
    // Losing resume state is safer than interrupting the active run.
  }
}

export function clearSnapshot(): void {
  try {
    sessionStorage.removeItem(RUN_KEY);
  } catch {
    // The stale value is harmless and remains scoped to this tab.
  }
}

export function readRoomSeen(): number {
  try {
    const raw = Number(localStorage.getItem(ROOM_SEEN_KEY));
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

export function writeRoomSeen(at: number): void {
  try {
    localStorage.setItem(ROOM_SEEN_KEY, String(at));
  } catch {
    // Treat the room as unread next session when storage is unavailable.
  }
}

/** Longest a tour nobody finishes is allowed to keep coming back. */
export const TOUR_MAX_SHOWS = 3;

/**
 * How many times a run has opened with the tour on it.
 *
 * Counted rather than merely flagged, because a player who quits mid-tour has
 * not been taught and should get it again, and a player who quits mid-tour
 * three times has told us something else entirely. The cap is what stops "not
 * finished" from meaning "forever".
 */
export function readTourShows(): number {
  try {
    const raw = Number(localStorage.getItem(TOUR_SHOWS_KEY));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  } catch {
    return 0;
  }
}

/**
 * Has this device been shown the controls?
 *
 * Per device on purpose. Somebody who learned this on a laptop and opened it on
 * a phone has not learned the phone controls, because they are not the same
 * controls: one of them is two thumbs on a sheet of glass. A server-side flag
 * against the X account would carry the wrong fact across.
 *
 * Blocked storage reports "not done", so a player in private mode is taught
 * rather than left with an unexplained ship. Being shown it twice is a smaller
 * failure than never being shown it.
 */
export function readTourDone(): boolean {
  try {
    if (localStorage.getItem(TOUR_DONE_KEY) === '1') return true;
  } catch {
    return false;
  }
  return readTourShows() >= TOUR_MAX_SHOWS;
}

export function writeTourDone(): void {
  try {
    localStorage.setItem(TOUR_DONE_KEY, '1');
  } catch {
    // The tour runs again next session. Harmless, and skippable in one tap.
  }
}

export function countTourShow(): void {
  try {
    localStorage.setItem(TOUR_SHOWS_KEY, String(readTourShows() + 1));
  } catch {
    // Without the count the cap cannot bite, so the done flag is the only stop.
  }
}

/** Settings offers this, so a tour skipped by accident is not gone for good. */
export function clearTourDone(): void {
  try {
    localStorage.removeItem(TOUR_DONE_KEY);
    localStorage.removeItem(TOUR_SHOWS_KEY);
  } catch {
    // Nothing was stored to begin with.
  }
}
