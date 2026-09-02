import { isAtlasSimulationPaused, type AtlasAction, type AtlasPosition } from './state';
import type { AtlasTool } from './types';

export const ATLAS_EXPEDITION_MAX_TICKS = 3_600;
export const ATLAS_EXPEDITION_MAX_TRACE_ACTIONS = 20_000;
export const ATLAS_EXPEDITION_MAX_TRACE_BYTES = 256 * 1024;
export const ATLAS_EXPEDITION_WORLD = Object.freeze({ width: 2_400, height: 1_400 });

const TOOLS: readonly AtlasTool[] = ['scanner', 'relay-tether', 'shield-pulse'];
const CONTEXT_TOOLS: readonly ('none' | AtlasTool)[] = ['none', ...TOOLS];
const SYSTEMS = ['active', 'paused', 'hidden'] as const;
const RULESET_HASH = 'atlas-expedition-ruleset-v1';

export type AtlasExpeditionAction = AtlasAction & {
  scan: boolean;
  contextTool: 'none' | AtlasTool;
  position?: AtlasPosition;
};

export type AtlasExpeditionPhase = 'brief' | 'prepare' | 'running' | 'extracting' | 'completed' | 'failed';
export type AtlasExpeditionFailure = 'timeout' | 'malformed';

export interface AtlasDailyExpeditionDefinition {
  id: string;
  date: string;
  title: string;
  briefing: string;
  contentHash: string;
  rulesetHash: string;
  spawn: AtlasPosition;
  relay: AtlasPosition & { id: string };
  fault: AtlasPosition & { id: string };
  extract: AtlasPosition & { id: string };
  teachBackAnswer: string;
  lessonFragmentIds: string[];
}

export interface AtlasExpeditionTrace {
  definitionId: string;
  contentHash: string;
  rulesetHash: string;
  loadout: AtlasTool;
  actions: readonly AtlasExpeditionAction[];
  teachBackAnswer: string | null;
}

export interface AtlasExpeditionState {
  version: 1;
  phase: AtlasExpeditionPhase;
  tick: number;
  definitionId: string;
  loadout: AtlasTool | 'none';
  player: AtlasPosition;
  scanComplete: boolean;
  diagnosisComplete: boolean;
  extractionComplete: boolean;
  teachBackComplete: boolean;
  failure: AtlasExpeditionFailure | null;
}

const TEMPLATES = [
  {
    title: 'The Quiet Relay',
    briefing: 'A relay has gone quiet before the market opens. Read the route, shield the fault, and bring the signal home.',
    lessonFragmentIds: ['ask', 'check', 'confirm'],
  },
  {
    title: 'A Route Worth Keeping',
    briefing: 'A safe payment route is flickering at the edge of the district. Inspect what is real before you reconnect it.',
    lessonFragmentIds: ['check', 'transaction', 'confirm'],
  },
  {
    title: 'The Lantern Circuit',
    briefing: 'The harbor lanterns are dimming one by one. Find the broken link, make a careful repair, and return with proof.',
    lessonFragmentIds: ['luna', 'approve', 'unlock'],
  },
  {
    title: 'Signal Through the Fog',
    briefing: 'A useful signal is buried under stale noise. Scan before acting, then carry the verified reading to the extraction gate.',
    lessonFragmentIds: ['consensus', 'confirm', 'retry'],
  },
] as const;

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function dateSeed(date: string): number {
  return Number.parseInt(hashText(date), 16) >>> 0;
}

function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) {
    throw new Error('Daily expedition date is malformed.');
  }
}

function near(a: AtlasPosition, b: AtlasPosition, radius = 64): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= radius;
}

function movePosition(position: AtlasPosition, action: AtlasExpeditionAction): AtlasPosition {
  return {
    x: Math.max(0, Math.min(ATLAS_EXPEDITION_WORLD.width, position.x + Math.sign(action.moveX) * 16)),
    y: Math.max(0, Math.min(ATLAS_EXPEDITION_WORLD.height, position.y + Math.sign(action.moveY) * 16)),
  };
}

export function createDailyExpedition(date: string): AtlasDailyExpeditionDefinition {
  assertDate(date);
  const seed = dateSeed(date);
  const template = TEMPLATES[seed % TEMPLATES.length];
  const offset = (seed % 3) * 24;
  const definition: AtlasDailyExpeditionDefinition = {
    id: `field-expedition-${date}-${seed.toString(16).padStart(8, '0')}`,
    date,
    title: template.title,
    briefing: template.briefing,
    contentHash: '',
    rulesetHash: RULESET_HASH,
    spawn: { x: 160, y: 160 },
    relay: { id: 'relay-signal', x: 640 + offset, y: 240 },
    fault: { id: 'fault-route', x: 1_280, y: 720 + offset },
    extract: { id: 'extract-gate', x: 2_080 - offset, y: 1_120 },
    teachBackAnswer: 'check the recipient, approve intentionally, and wait for confirmation before unlock',
    lessonFragmentIds: [...template.lessonFragmentIds],
  };
  definition.contentHash = `atlas-content-${hashText(JSON.stringify(definition))}`;
  return Object.freeze(definition);
}

export function createAtlasExpeditionState(definition: AtlasDailyExpeditionDefinition, loadout: AtlasTool | 'none' = 'none'): AtlasExpeditionState {
  return {
    version: 1,
    phase: 'brief',
    tick: 0,
    definitionId: definition.id,
    loadout,
    player: { ...definition.spawn },
    scanComplete: false,
    diagnosisComplete: false,
    extractionComplete: false,
    teachBackComplete: false,
    failure: null,
  };
}

export function stepAtlasExpedition(state: AtlasExpeditionState, definition: AtlasDailyExpeditionDefinition, action: AtlasExpeditionAction): AtlasExpeditionState {
  const next = structuredClone(state);
  if (next.phase !== 'running' || isAtlasSimulationPaused(action)) return next;
  next.tick += 1;
  if (next.tick >= ATLAS_EXPEDITION_MAX_TICKS) {
    next.phase = 'failed';
    next.failure = 'timeout';
    return next;
  }
  next.player = movePosition(next.player, action);
  if (near(next.player, definition.relay) && action.scan && (action.tool === 'scanner' || action.contextTool === 'scanner')) next.scanComplete = true;
  if (near(next.player, definition.fault) && (action.tool === 'shield-pulse' || action.contextTool === 'shield-pulse')) {
    next.diagnosisComplete = next.scanComplete;
  }
  if (near(next.player, definition.extract) && action.interact && next.diagnosisComplete) {
    next.extractionComplete = true;
    next.phase = 'extracting';
  }
  return next;
}

export function diagnoseAtlasExpedition(state: AtlasExpeditionState, definition: AtlasDailyExpeditionDefinition): AtlasExpeditionState {
  if (state.phase !== 'running' || !state.scanComplete || !state.diagnosisComplete || !near(state.player, definition.fault)) throw new Error('Expedition fault is not ready to diagnose.');
  return structuredClone(state);
}

export function extractAtlasExpedition(state: AtlasExpeditionState, definition: AtlasDailyExpeditionDefinition): AtlasExpeditionState {
  if (state.phase !== 'running' || !state.diagnosisComplete || !near(state.player, definition.extract)) throw new Error('Expedition extraction is not ready.');
  return { ...structuredClone(state), phase: 'extracting', extractionComplete: true };
}

export function completeAtlasExpedition(state: AtlasExpeditionState, definition: AtlasDailyExpeditionDefinition, answer: string): AtlasExpeditionState {
  if (state.phase !== 'extracting' || !state.extractionComplete || answer.trim().toLowerCase() !== definition.teachBackAnswer) throw new Error('Expedition teach-back is incorrect.');
  return { ...structuredClone(state), phase: 'completed', teachBackComplete: true };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertAction(action: unknown): asserts action is AtlasExpeditionAction {
  if (!isObject(action)) throw new Error('Atlas expedition trace action is malformed.');
  if (typeof action.moveX !== 'number' || typeof action.moveY !== 'number' || !Number.isFinite(action.moveX) || !Number.isFinite(action.moveY) || Math.abs(action.moveX) > 127 || Math.abs(action.moveY) > 127) throw new Error('Atlas expedition movement is malformed.');
  if (!TOOLS.includes(action.tool as AtlasTool) && action.tool !== 'none') throw new Error('Atlas expedition tool is malformed.');
  if (!CONTEXT_TOOLS.includes(action.contextTool as 'none' | AtlasTool)) throw new Error('Atlas expedition context tool is malformed.');
  if (typeof action.interact !== 'boolean' || typeof action.scan !== 'boolean') throw new Error('Atlas expedition action flags are malformed.');
  if (action.system !== undefined && (typeof action.system !== 'string' || !SYSTEMS.includes(action.system as (typeof SYSTEMS)[number]))) throw new Error('Atlas expedition system state is malformed.');
  if (action.position !== undefined) {
    if (!isObject(action.position) || typeof action.position.x !== 'number' || typeof action.position.y !== 'number' || !Number.isFinite(action.position.x) || !Number.isFinite(action.position.y) || action.position.x < 0 || action.position.y < 0 || action.position.x > ATLAS_EXPEDITION_WORLD.width || action.position.y > ATLAS_EXPEDITION_WORLD.height) throw new Error('Atlas expedition position is malformed.');
  }
}

export function validateAtlasExpeditionTrace(definition: AtlasDailyExpeditionDefinition, trace: unknown): trace is AtlasExpeditionTrace {
  if (!isObject(trace)) throw new Error('Atlas expedition trace is malformed.');
  if (trace.definitionId !== definition.id || trace.contentHash !== definition.contentHash || trace.rulesetHash !== definition.rulesetHash) throw new Error('Atlas expedition trace hash or definition does not match.');
  if (!TOOLS.includes(trace.loadout as AtlasTool)) throw new Error('Atlas expedition loadout is malformed.');
  if (!Array.isArray(trace.actions)) throw new Error('Atlas expedition trace actions are malformed.');
  if (trace.actions.length > ATLAS_EXPEDITION_MAX_TRACE_ACTIONS) throw new Error('Atlas expedition trace is too large.');
  if (trace.actions.length > ATLAS_EXPEDITION_MAX_TICKS) throw new Error('Atlas expedition trace exceeds the tick limit.');
  if (trace.teachBackAnswer !== null && typeof trace.teachBackAnswer !== 'string') throw new Error('Atlas expedition teach-back is malformed.');
  if (typeof trace.teachBackAnswer === 'string' && trace.teachBackAnswer.length > 240) throw new Error('Atlas expedition teach-back is too large.');
  for (const action of trace.actions) assertAction(action);
  if (JSON.stringify(trace).length > ATLAS_EXPEDITION_MAX_TRACE_BYTES) throw new Error('Atlas expedition trace exceeds the byte limit.');
  return true;
}

export function replayAtlasExpedition(definition: AtlasDailyExpeditionDefinition, trace: AtlasExpeditionTrace): AtlasExpeditionState {
  validateAtlasExpeditionTrace(definition, trace);
  let state = createAtlasExpeditionState(definition, trace.loadout);
  state.phase = 'running';
  for (const action of trace.actions) {
    state = stepAtlasExpedition(state, definition, action);
    if (state.phase === 'failed' || state.phase === 'extracting' || state.phase === 'completed') break;
  }
  if (state.phase === 'extracting' && trace.teachBackAnswer !== null) state = completeAtlasExpedition(state, definition, trace.teachBackAnswer);
  return state;
}
