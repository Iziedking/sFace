import type { AtlasQualityTier } from '../../../shared/atlas/city/types';
import { BEACON_COMMONS_CROWD, scheduleCrowd, type AtlasCitizenDefinition, type AtlasCitizenPresentation } from '../../../shared/atlas/city/crowd';

export class AtlasCrowdController {
  private readonly roster: readonly AtlasCitizenDefinition[];
  private latest: readonly AtlasCitizenPresentation[] = [];

  constructor(roster: readonly AtlasCitizenDefinition[] = BEACON_COMMONS_CROWD) {
    this.roster = roster;
  }

  update(districtId: string, daySeed: string, restorationState: 'waiting' | 'confirming' | 'restored', qualityTier: AtlasQualityTier, tick: number): readonly AtlasCitizenPresentation[] {
    this.latest = scheduleCrowd({ districtId, daySeed, restorationState, qualityTier, tick }, this.roster);
    return this.latest;
  }

  snapshot(): readonly AtlasCitizenPresentation[] {
    return this.latest;
  }
}
