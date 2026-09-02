import type { AtlasAction } from '../../shared/atlas/state';
import type { AtlasExpeditionAction } from '../../shared/atlas/expedition';
import type { AtlasTool } from '../../shared/atlas/types';

export type AtlasDirection = 'up' | 'down' | 'left' | 'right';
export interface AtlasWorldPoint { x: number; y: number; }

const DESTINATION_DEAD_ZONE = 28;
const CAMERA_YAW_RADIANS_PER_PIXEL = 0.0065;
const MAXIMUM_CAMERA_DRAG_PIXELS_PER_EVENT = 80;

export function shouldHandleDirectionalClick(detail: number): boolean {
  return detail === 0;
}

export class AtlasCameraLookController {
  private activePointer: number | null = null;
  private lastClientX = 0;

  begin(pointerId: number, clientX: number): void {
    assertFiniteScalar(pointerId, 'camera pointer');
    assertFiniteScalar(clientX, 'camera position');
    this.activePointer = pointerId;
    this.lastClientX = clientX;
  }

  move(pointerId: number, clientX: number): number {
    assertFiniteScalar(clientX, 'camera position');
    if (pointerId !== this.activePointer) return 0;
    const deltaPixels = Math.max(
      -MAXIMUM_CAMERA_DRAG_PIXELS_PER_EVENT,
      Math.min(MAXIMUM_CAMERA_DRAG_PIXELS_PER_EVENT, clientX - this.lastClientX),
    );
    this.lastClientX = clientX;
    return -deltaPixels * CAMERA_YAW_RADIANS_PER_PIXEL;
  }

  end(pointerId: number): boolean {
    if (pointerId !== this.activePointer) return false;
    this.activePointer = null;
    return true;
  }
}

export class AtlasInputController {
  private readonly held = new Set<AtlasDirection>();
  private pendingTool: AtlasTool | 'none' = 'none';
  private pendingScan = false;
  private pendingContextTool: AtlasTool | 'none' = 'none';
  private pendingInteract = false;
  private system: NonNullable<AtlasAction['system']> = 'active';
  private destination: AtlasWorldPoint | null = null;
  private joystick: AtlasWorldPoint | null = null;

  setJoystick(vector: AtlasWorldPoint): void {
    assertFinitePoint(vector);
    this.joystick = { x: Math.max(-1, Math.min(1, vector.x)), y: Math.max(-1, Math.min(1, vector.y)) };
  }

  clearJoystick(): void {
    this.joystick = null;
  }

  setDestination(point: AtlasWorldPoint): void {
    assertFinitePoint(point);
    this.destination = { x: Math.round(point.x), y: Math.round(point.y) };
  }

  cancelDestination(): void {
    this.destination = null;
  }

  setDirection(direction: AtlasDirection, pressed: boolean): void {
    if (pressed) this.held.add(direction);
    else this.held.delete(direction);
  }

  triggerTool(tool: AtlasTool): void {
    this.pendingTool = tool;
  }

  triggerScan(): void {
    this.pendingScan = true;
    this.pendingContextTool = 'scanner';
    this.pendingTool = 'scanner';
  }

  triggerContextTool(tool: AtlasTool): void {
    this.pendingContextTool = tool;
    this.pendingTool = tool;
  }

  triggerInteract(): void {
    this.pendingInteract = true;
  }

  setSystem(system: NonNullable<AtlasAction['system']>): void {
    this.system = system;
    if (system !== 'active') {
      this.held.clear();
      this.cancelDestination();
    }
  }

  sample(): AtlasAction {
    const movement = this.held.size > 0 ? this.heldMovement() : this.joystickMovement();
    return this.sampleMovement(movement);
  }

  sampleExpedition(): AtlasExpeditionAction {
    const movement = this.held.size > 0 ? this.heldMovement() : this.joystickMovement();
    const action: AtlasExpeditionAction = {
      ...this.sampleMovement(movement),
      scan: this.pendingScan,
      contextTool: this.pendingContextTool,
    };
    this.pendingScan = false;
    this.pendingContextTool = 'none';
    return action;
  }

  sampleFor(position: AtlasWorldPoint): AtlasAction {
    assertFinitePoint(position);
    if (this.held.size > 0) return this.sampleMovement(this.heldMovement());
    if (this.system !== 'active' || !this.destination) return this.sampleMovement({ moveX: 0, moveY: 0 });
    const deltaX = this.destination.x - position.x;
    const deltaY = this.destination.y - position.y;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) <= DESTINATION_DEAD_ZONE) {
      this.cancelDestination();
      return this.sampleMovement({ moveX: 0, moveY: 0 });
    }
    const magnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    return this.sampleMovement({ moveX: Math.round((deltaX / magnitude) * 127), moveY: Math.round((deltaY / magnitude) * 127) });
  }

  private sampleMovement(movement: { moveX: number; moveY: number }): AtlasAction {
    const action: AtlasAction = {
      moveX: movement.moveX,
      moveY: movement.moveY,
      tool: this.pendingTool,
      interact: this.pendingInteract,
      system: this.system,
    };
    this.pendingTool = 'none';
    this.pendingInteract = false;
    return action;
  }

  private joystickMovement(): { moveX: number; moveY: number } {
    if (this.system !== 'active' || !this.joystick) return { moveX: 0, moveY: 0 };
    return { moveX: Math.round(this.joystick.x * 127), moveY: Math.round(this.joystick.y * 127) };
  }

  private heldMovement(): { moveX: number; moveY: number } {
    return {
      moveX: (this.held.has('right') ? 127 : 0) - (this.held.has('left') ? 127 : 0),
      moveY: (this.held.has('down') ? 127 : 0) - (this.held.has('up') ? 127 : 0),
    };
  }
}

function assertFinitePoint(point: AtlasWorldPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Atlas destination must be finite.');
}

function assertFiniteScalar(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Atlas ${label} must be finite.`);
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
    if (event.key === 'q' || event.key === 'Q') input.triggerScan();
    else if (event.key === 'e' || event.key === 'E') input.triggerContextTool('relay-tether');
    else if (event.key === 'Shift') input.triggerContextTool('shield-pulse');
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
