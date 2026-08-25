import type { AtlasAction, AtlasEventType, AtlasState } from './state';

const MOVE_PER_TICK = 100;
const PLAYER_RADIUS = 30;
const TOOL_RANGE = 600;
const INTERACT_RANGE = 180;
const SHIELD_DURATION_TICKS = 30;
const SHIELD_COOLDOWN_TICKS = 90;
const COLLISION_COOLDOWN_TICKS = 20;

export function stepAtlas(state: AtlasState, input: AtlasAction): void {
  if (state.phase !== 'running') return;
  const action = normalizeAction(input);
  if (action.system === 'paused' || action.system === 'hidden') {
    emit(state, action.system, state.mission.id);
    return;
  }
  state.tick += 1;
  state.player.collisionCooldown = Math.max(0, state.player.collisionCooldown - 1);
  state.player.shieldTicks = Math.max(0, state.player.shieldTicks - 1);
  state.player.shieldCooldown = Math.max(0, state.player.shieldCooldown - 1);

  if (action.tool === 'shield-pulse' && state.player.shieldCooldown === 0) {
    state.player.shieldTicks = SHIELD_DURATION_TICKS;
    state.player.shieldCooldown = SHIELD_COOLDOWN_TICKS;
  }

  state.player.x = clamp(state.player.x + scaleMove(action.moveX), 0, state.mission.width);
  state.player.y = clamp(state.player.y + scaleMove(action.moveY), 0, state.mission.height);
  if (action.moveX > 0) state.player.facing = 'right';
  else if (action.moveX < 0) state.player.facing = 'left';
  else if (action.moveY > 0) state.player.facing = 'down';
  else if (action.moveY < 0) state.player.facing = 'up';

  if (action.tool === 'scanner') {
    for (const relay of state.relays) {
      if (!relay.scanned && inRange(state.player, relay, TOOL_RANGE)) {
        relay.scanned = true;
        emit(state, 'relay-scanned', relay.id);
      }
    }
  }
  if (action.tool === 'relay-tether') {
    for (const relay of state.relays) {
      if (relay.scanned && !relay.connected && inRange(state.player, relay, TOOL_RANGE)) {
        relay.connected = true;
        emit(state, 'relay-connected', relay.id);
      }
    }
  }

  resolveFaults(state);
  if (state.player.integrity <= 0) {
    state.phase = 'failed';
    return;
  }

  if (action.interact && !state.rescue.rescued && state.relays.every((relay) => relay.connected) && inRange(state.player, state.rescue, INTERACT_RANGE)) {
    state.rescue.rescued = true;
    state.gate.unlocked = true;
    emit(state, 'rescued', state.rescue.id);
    emit(state, 'gate-opened', state.gate.id);
  }
  if (action.interact && state.gate.unlocked && inRange(state.player, state.gate, INTERACT_RANGE)) {
    state.phase = 'completed';
    emit(state, 'district-completed', state.mission.id);
  }
}

function normalizeAction(input: AtlasAction): AtlasAction {
  if (!Number.isFinite(input.moveX) || !Number.isFinite(input.moveY)) throw new Error('Atlas movement must be finite.');
  if (!['none', 'scanner', 'relay-tether', 'shield-pulse'].includes(input.tool)) throw new Error('Atlas tool is invalid.');
  return {
    moveX: clamp(Math.round(input.moveX), -127, 127),
    moveY: clamp(Math.round(input.moveY), -127, 127),
    tool: input.tool,
    interact: input.interact === true,
    system: input.system ?? 'active',
  };
}

function scaleMove(value: number): number {
  if (value === 0) return 0;
  return Math.trunc((value * MOVE_PER_TICK) / 127);
}

function resolveFaults(state: AtlasState): void {
  for (const fault of state.faults) {
    if (!fault.active || !inRange(state.player, fault, fault.radius + PLAYER_RADIUS)) continue;
    fault.active = false;
    if (state.player.shieldTicks > 0) emit(state, 'fault-shielded', fault.id);
    else if (state.player.collisionCooldown === 0) {
      state.player.integrity -= 1;
      state.player.collisionCooldown = COLLISION_COOLDOWN_TICKS;
      emit(state, 'fault-hit', fault.id);
    }
  }
}

function inRange(left: { x: number; y: number }, right: { x: number; y: number }, range: number): boolean {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y <= range * range;
}

function emit(state: AtlasState, type: AtlasEventType, targetId: string): void {
  state.events.push({ tick: state.tick, type, targetId });
  if (state.events.length > 64) state.events.splice(0, state.events.length - 64);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
