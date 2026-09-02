import {
  completeAtlasExpedition,
  createAtlasExpeditionState,
  diagnoseAtlasExpedition,
  extractAtlasExpedition,
  stepAtlasExpedition,
  type AtlasDailyExpeditionDefinition,
  type AtlasExpeditionAction,
  type AtlasExpeditionState,
  type AtlasExpeditionTrace,
} from '../../../shared/atlas/expedition';
import type { AtlasTool } from '../../../shared/atlas/types';

export function createAtlasExpeditionController(definition: AtlasDailyExpeditionDefinition) {
  let current = createAtlasExpeditionState(definition);
  const actions: AtlasExpeditionAction[] = [];
  let teachBackAnswer: string | null = null;

  return {
    state(): AtlasExpeditionState {
      return structuredClone(current);
    },
    prepare(loadout: AtlasTool): AtlasExpeditionState {
      if (current.phase !== 'brief') throw new Error('Expedition loadout is not available.');
      current = { ...current, phase: 'prepare', loadout };
      return structuredClone(current);
    },
    start(): AtlasExpeditionState {
      if (current.phase !== 'prepare' || current.loadout === 'none') throw new Error('Expedition needs a loadout before launch.');
      current = { ...current, phase: 'running' };
      return structuredClone(current);
    },
    step(action: AtlasExpeditionAction): AtlasExpeditionState {
      if (current.phase !== 'running') return structuredClone(current);
      actions.push(structuredClone(action));
      current = stepAtlasExpedition(current, definition, action);
      return structuredClone(current);
    },
    diagnose(): AtlasExpeditionState {
      current = diagnoseAtlasExpedition(current, definition);
      return structuredClone(current);
    },
    extract(): AtlasExpeditionState {
      current = extractAtlasExpedition(current, definition);
      actions.push({ moveX: 0, moveY: 0, tool: 'none', interact: true, scan: false, contextTool: 'none', system: 'active' });
      return structuredClone(current);
    },
    teachBack(answer: string): AtlasExpeditionState {
      teachBackAnswer = answer;
      current = completeAtlasExpedition(current, definition, answer);
      return structuredClone(current);
    },
    trace(): AtlasExpeditionTrace {
      return {
        definitionId: definition.id,
        contentHash: definition.contentHash,
        rulesetHash: definition.rulesetHash,
        loadout: current.loadout === 'none' ? 'scanner' : current.loadout,
        actions: structuredClone(actions),
        teachBackAnswer,
      };
    },
  };
}
