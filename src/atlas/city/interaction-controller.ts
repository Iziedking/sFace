import { chooseEligibleInteraction, type AtlasCityInteractionAction, type AtlasCityTarget, type AtlasCityVector2 } from '../../../shared/atlas/city/interactions';

export interface AtlasCityInteractionIntent {
  readonly targetId: string;
  readonly action: AtlasCityInteractionAction;
}

export class AtlasInteractionController {
  private heldTargetId: string | null = null;

  eligible(player: AtlasCityVector2, targets: readonly AtlasCityTarget[]): AtlasCityTarget | null {
    return chooseEligibleInteraction(player, targets);
  }

  trigger(player: AtlasCityVector2, targets: readonly AtlasCityTarget[]): AtlasCityInteractionIntent | null {
    const target = this.eligible(player, targets);
    if (!target || this.heldTargetId === target.id) return null;
    this.heldTargetId = target.id;
    return { targetId: target.id, action: target.action };
  }

  release(): void {
    this.heldTargetId = null;
  }

  reset(): void {
    this.heldTargetId = null;
  }
}
