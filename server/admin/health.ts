import { buildCapabilities, type Capabilities } from '../capabilities';
import type { PersistenceHealth } from '../store';

export interface HealthInputs {
  persistence: PersistenceHealth;
  anchor: boolean;
  xOAuth: boolean;
  xRead: boolean;
  xSense: boolean;
  signals: boolean;
  corsRestricted: boolean;
  trustedProxy: boolean;
}

export interface EffectiveHealth {
  persistence: PersistenceHealth;
  capabilities: Capabilities;
}

export function effectiveHealth(input: HealthInputs): EffectiveHealth {
  return {
    persistence: input.persistence,
    capabilities: buildCapabilities({
      persistence: input.persistence.status === 'healthy',
      anchor: input.anchor,
      xOAuth: input.xOAuth,
      xRead: input.xRead,
      xSense: input.xSense,
      signals: input.signals,
      corsRestricted: input.corsRestricted,
      trustedProxy: input.trustedProxy,
    }),
  };
}
