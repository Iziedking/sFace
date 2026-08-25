import type { AtlasAction } from '../../shared/atlas/state';
import type { AtlasTool } from '../../shared/atlas/types';

export type AtlasDirection = 'up' | 'down' | 'left' | 'right';

export class AtlasInputController {
  private readonly held = new Set<AtlasDirection>();
  private pendingTool: AtlasTool | 'none' = 'none';
  private pendingInteract = false;
  private system: NonNullable<AtlasAction['system']> = 'active';

  setDirection(direction: AtlasDirection, pressed: boolean): void {
    if (pressed) this.held.add(direction);
    else this.held.delete(direction);
  }

  triggerTool(tool: AtlasTool): void {
    this.pendingTool = tool;
  }

  triggerInteract(): void {
    this.pendingInteract = true;
  }

  setSystem(system: NonNullable<AtlasAction['system']>): void {
    this.system = system;
    if (system !== 'active') this.held.clear();
  }

  sample(): AtlasAction {
    const action: AtlasAction = {
      moveX: (this.held.has('right') ? 127 : 0) - (this.held.has('left') ? 127 : 0),
      moveY: (this.held.has('down') ? 127 : 0) - (this.held.has('up') ? 127 : 0),
      tool: this.pendingTool,
      interact: this.pendingInteract,
      system: this.system,
    };
    this.pendingTool = 'none';
    this.pendingInteract = false;
    return action;
  }
}

export function installAtlasKeyboard(target: Window, input: AtlasInputController): () => void {
  const directions: Record<string, AtlasDirection | undefined> = {
    ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
  };
  const down = (event: KeyboardEvent): void => {
    const direction = directions[event.key];
    if (direction) { event.preventDefault(); input.setDirection(direction, true); return; }
    if (event.repeat) return;
    if (event.key === 'q' || event.key === 'Q') input.triggerTool('scanner');
    else if (event.key === 'e' || event.key === 'E') input.triggerTool('relay-tether');
    else if (event.key === 'Shift') input.triggerTool('shield-pulse');
    else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); input.triggerInteract(); }
  };
  const up = (event: KeyboardEvent): void => {
    const direction = directions[event.key];
    if (direction) input.setDirection(direction, false);
  };
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  return () => { target.removeEventListener('keydown', down); target.removeEventListener('keyup', up); };
}
