/**
 * The client half of live co-op.
 *
 * Everything here is optional. If the socket never opens, the run is exactly
 * the same run with fewer ships in it, and the player is never told about a
 * failure they cannot act on. That is why there is no error callback: a
 * squadmate who does not appear is indistinguishable from a squadmate who was
 * never there, and inventing a red banner for it would be noise.
 *
 * Poses go out at 10Hz. Sixty would be smoother and pointless, since the
 * receiving end interpolates anyway and a phone on mobile data would rather
 * send six times less.
 */

import type { GhostFrame } from '../game/ghost';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const SEND_HZ = 10;
const SEND_INTERVAL_MS = 1000 / SEND_HZ;
/** Give up after this many attempts. Live co-op is not worth a retry loop. */
const MAX_ATTEMPTS = 3;

export interface LiveHandlers {
  onJoin(id: string, name: string): void;
  onLeave(id: string): void;
  onPose(id: string, frame: GhostFrame): void;
  /** Room was already full. Ghosts still fill the squad. */
  onFull(): void;
}

export function liveUrl(): string | null {
  if (!API_BASE) return null;
  try {
    const url = new URL(API_BASE, window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/, '')}/live`;
    return url.toString();
  } catch {
    return null;
  }
}

export class LiveLink {
  private socket: WebSocket | null = null;
  private lastSentAt = 0;
  private attempts = 0;
  private closed = false;

  constructor(
    private seed: string,
    private id: string,
    private name: string,
    private handlers: LiveHandlers,
  ) {}

  connect(): void {
    if (this.closed) return;

    const url = liveUrl();
    if (!url) return;
    if (this.attempts >= MAX_ATTEMPTS) return;
    this.attempts++;

    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      return;
    }

    this.socket = socket;

    socket.addEventListener('open', () => {
      this.send({ t: 'join', seed: this.seed, id: this.id, name: this.name });
    });

    socket.addEventListener('message', (event) => this.receive(event));

    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.closed) return;
      // One quiet retry, backing off. Beyond that, play with ghosts.
      const wait = 1200 * this.attempts;
      window.setTimeout(() => this.connect(), wait);
    });

    socket.addEventListener('error', () => {
      // 'close' always follows, and that is where the retry lives.
    });
  }

  private receive(event: MessageEvent): void {
    let message: unknown;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;

    const payload = message as Record<string, unknown>;

    switch (payload.t) {
      case 'here': {
        // Everyone already in the room when we arrived.
        const members = Array.isArray(payload.members) ? payload.members : [];
        for (const entry of members) {
          if (typeof entry !== 'object' || entry === null) continue;
          const { id, name } = entry as Record<string, unknown>;
          if (typeof id === 'string' && typeof name === 'string') {
            this.handlers.onJoin(id, name);
          }
        }
        break;
      }
      case 'join':
        if (typeof payload.id === 'string' && typeof payload.name === 'string') {
          this.handlers.onJoin(payload.id, payload.name);
        }
        break;
      case 'leave':
        if (typeof payload.id === 'string') this.handlers.onLeave(payload.id);
        break;
      case 'pose': {
        const frame = toFrame(payload);
        if (frame && typeof payload.id === 'string') {
          this.handlers.onPose(payload.id, frame);
        }
        break;
      }
      case 'full':
        this.handlers.onFull();
        break;
      default:
        break;
    }
  }

  /** Call every frame. Throttles internally to the send rate. */
  publish(frame: GhostFrame, nowMs: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (nowMs - this.lastSentAt < SEND_INTERVAL_MS) return;
    this.lastSentAt = nowMs;

    this.send({
      t: 'pose',
      x: Math.round(frame.x * 10) / 10,
      y: Math.round(frame.y * 10) / 10,
      a: Math.round(frame.angle * 1000) / 1000,
      f: frame.firing,
      d: frame.down,
      c: frame.carrying,
    });
  }

  close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close();
    } catch {
      // Already gone.
    }
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      // The close handler deals with it.
    }
  }
}

function toFrame(payload: Record<string, unknown>): GhostFrame | null {
  const x = payload.x;
  const y = payload.y;
  const a = payload.a;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof a !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(a)) return null;

  return {
    x,
    y,
    angle: a,
    firing: payload.f === true,
    down: payload.d === true,
    carrying: typeof payload.c === 'number' ? Math.max(0, Math.min(7, payload.c | 0)) : 0,
  };
}

export { SEND_HZ };
