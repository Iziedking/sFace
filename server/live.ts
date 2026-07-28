/**
 * Live co-op, which is a relay and nothing more.
 *
 * There is no authoritative state here and no simulation. Everyone in a room
 * is flying the same seeded level, so the terrain, the attackers and the faces
 * already match on every client without a single byte crossing the wire. The
 * only thing anyone needs from anyone else is where they are, and that is all
 * this forwards.
 *
 * That is why live co-op is cheap enough to ship: the hard part of netcode is
 * agreeing on world state, and the seed already did that. What is left is
 * about a hundred lines of socket plumbing, and the worst a dropped packet can
 * do is make a squadmate's ship stutter.
 *
 * A room is a mission seed. Joining a room you have no business being in gains
 * you nothing, since everything in it is public and cosmetic.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';

/** Ships on screen at once. The client draws at most five squadmates. */
const MAX_ROOM = 6;
/** Poses are sent at 10Hz. This allows headroom without allowing a flood. */
const MAX_POSES_PER_SECOND = 20;
const MAX_MESSAGE_BYTES = 512;
/** A socket that has not spoken in this long is gone, whatever it thinks. */
const HEARTBEAT_MS = 30_000;

interface Member {
  socket: WebSocket;
  id: string;
  name: string;
  seed: string;
  /** Token bucket for pose messages. */
  tokens: number;
  lastRefill: number;
  alive: boolean;
}

const rooms = new Map<string, Set<Member>>();

export function attachLive(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/live', maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (socket) => {
    let member: Member | null = null;

    socket.on('message', (raw) => {
      // Anything oversized was already refused by maxPayload, but a client can
      // still send well-sized nonsense, so every branch below validates.
      let message: unknown;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (!isObject(message)) return;

      if (message.t === 'join') {
        if (member) return; // One join per socket.
        member = join(socket, message);
        return;
      }

      if (message.t === 'pose' && member) {
        relayPose(member, message);
      }
    });

    socket.on('pong', () => {
      if (member) member.alive = true;
    });

    socket.on('close', () => {
      if (member) leave(member);
      member = null;
    });

    socket.on('error', () => {
      if (member) leave(member);
      member = null;
    });
  });

  // Sockets die without a close event more often than you would like, and a
  // dead member leaves a ghost ship hovering in everyone else's run.
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const member of [...room]) {
        if (!member.alive) {
          member.socket.terminate();
          leave(member);
          continue;
        }
        member.alive = false;
        member.socket.ping();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function join(socket: WebSocket, message: Record<string, unknown>): Member | null {
  const seed = asString(message.seed, 120);
  const id = asString(message.id, 64);
  const name = asString(message.name, 32);
  if (!seed || !id || !name) return null;

  const room = rooms.get(seed) ?? new Set<Member>();
  rooms.set(seed, room);

  if (room.size >= MAX_ROOM) {
    send(socket, { t: 'full' });
    socket.close();
    return null;
  }

  // A second connection from the same device replaces the first, so a reload
  // does not leave a motionless copy of you in everyone else's sky.
  for (const existing of [...room]) {
    if (existing.id === id) {
      existing.socket.close();
      room.delete(existing);
    }
  }

  const member: Member = {
    socket,
    id,
    name,
    seed,
    tokens: MAX_POSES_PER_SECOND,
    lastRefill: Date.now(),
    alive: true,
  };
  room.add(member);

  // Tell the newcomer who is already here, and tell everyone else about them.
  send(socket, {
    t: 'here',
    members: [...room]
      .filter((other) => other !== member)
      .map((other) => ({ id: other.id, name: other.name })),
  });
  broadcast(room, member, { t: 'join', id, name });

  return member;
}

function relayPose(member: Member, message: Record<string, unknown>): void {
  const now = Date.now();
  member.tokens = Math.min(
    MAX_POSES_PER_SECOND,
    member.tokens + ((now - member.lastRefill) / 1000) * MAX_POSES_PER_SECOND,
  );
  member.lastRefill = now;
  if (member.tokens < 1) return;
  member.tokens -= 1;
  member.alive = true;

  const x = asNumber(message.x);
  const y = asNumber(message.y);
  const a = asNumber(message.a);
  if (x === null || y === null || a === null) return;

  const room = rooms.get(member.seed);
  if (!room) return;

  // Rebuilt rather than forwarded, so nothing a client invented rides along.
  broadcast(room, member, {
    t: 'pose',
    id: member.id,
    x: round(x, 1),
    y: round(y, 1),
    a: round(a, 3),
    f: message.f === true,
    d: message.d === true,
    c: clampInt(asNumber(message.c) ?? 0, 0, 7),
  });
}

function leave(member: Member): void {
  const room = rooms.get(member.seed);
  if (!room) return;

  room.delete(member);
  broadcast(room, member, { t: 'leave', id: member.id });

  if (room.size === 0) rooms.delete(member.seed);
}

function broadcast(room: Set<Member>, from: Member, payload: unknown): void {
  for (const other of room) {
    if (other === from) continue;
    send(other.socket, payload);
  }
}

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // A send that fails is a socket that is going away. The close or error
    // handler will clean it up.
  }
}

export function roomSizes(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const [seed, room] of rooms) sizes[seed] = room.size;
  return sizes;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export { MAX_ROOM };
