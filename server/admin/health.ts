import { buildCapabilities, type Capabilities } from '../capabilities';
import type { PersistenceHealth } from '../store';
import type { RelayPersistenceHealth } from '../relay/store';

export interface HealthInputs {
  persistence: PersistenceHealth;
  relayPersistence?: RelayPersistenceHealth;
  relayWriterCount?: number;
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
  relayPersistence: RelayPersistenceHealth;
  relayWriterCount?: number;
  capabilities: Capabilities;
}

export function effectiveHealth(input: HealthInputs): EffectiveHealth {
  const relayPersistence = input.relayPersistence ?? input.persistence;
  return {
    persistence: input.persistence,
    relayPersistence,
    relayWriterCount: input.relayWriterCount ?? 1,
    capabilities: buildCapabilities({
      persistence: input.persistence.status === 'healthy',
      relayPersistence: relayPersistence.status === 'healthy',
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
