import { STAGES } from './data/campaign';
import type { RunSnapshot } from './game/snapshot';

const STAGE_KEY = 'sface.stage';
const CLEARED_KEY = 'sface.cleared';
const RUN_KEY = 'sface.run';
const ROOM_SEEN_KEY = 'sface.room.seen';

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
