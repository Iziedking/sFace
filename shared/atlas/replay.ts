import { createAtlasState, snapshotAtlasState, type AtlasAction, type AtlasSnapshot } from './state';
import { stepAtlas } from './step';
import type { AtlasMissionDefinition } from './world';

export function replayAtlasActions(mission: AtlasMissionDefinition, actions: readonly AtlasAction[]): AtlasSnapshot {
  const state = createAtlasState(mission);
  for (const action of canonicalAtlasActions(actions)) stepAtlas(state, action);
  return snapshotAtlasState(state);
}

export function canonicalAtlasActions(actions: readonly AtlasAction[]): AtlasAction[] {
  if (!Array.isArray(actions) || actions.length > 20_000) throw new Error('Atlas action trace is malformed.');
  return actions.map((action) => {
    if (!action || !Number.isFinite(action.moveX) || !Number.isFinite(action.moveY)) throw new Error('Atlas action movement is malformed.');
    if (!['none', 'scanner', 'relay-tether', 'shield-pulse'].includes(action.tool)) throw new Error('Atlas action tool is malformed.');
    return {
      moveX: Math.max(-127, Math.min(127, Math.round(action.moveX))),
      moveY: Math.max(-127, Math.min(127, Math.round(action.moveY))),
      tool: action.tool,
      interact: action.interact === true,
      system: action.system ?? 'active',
    };
  });
}

export function scoreAtlasSnapshot(snapshot: AtlasSnapshot): number {
  const points: Record<AtlasSnapshot['events'][number]['type'], number> = {
    paused: 0,
    hidden: 0,
    'relay-scanned': 25,
    'relay-connected': 50,
    'fault-hit': -20,
    'fault-shielded': 10,
    rescued: 100,
    'gate-opened': 100,
    'district-completed': 250,
  };
  return Math.max(0, snapshot.events.reduce((total, event) => total + points[event.type], 0));
}

export async function hashAtlasActions(actions: readonly AtlasAction[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalAtlasActions(actions)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
