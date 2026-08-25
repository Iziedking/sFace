export interface CapabilityInputs {
  persistence: boolean;
  relayPersistence?: boolean;
  anchor: boolean;
  xOAuth: boolean;
  xRead: boolean;
  xSense: boolean;
  signals: boolean;
  corsRestricted: boolean;
  trustedProxy: boolean;
}

export interface CapabilityState {
  enabled: boolean;
  required: boolean;
}

export type Capabilities = Record<keyof CapabilityInputs | 'playerIdentity' | 'marketOracle', CapabilityState>;

export function buildCapabilities(input: CapabilityInputs): Capabilities {
  return {
    persistence: state(input.persistence, true),
    relayPersistence: state(input.relayPersistence ?? input.persistence, true),
    playerIdentity: state(true, true),
    marketOracle: state(true, true),
    anchor: state(input.anchor, false),
    xOAuth: state(input.xOAuth, false),
    xRead: state(input.xRead, false),
    xSense: state(input.xSense, false),
    signals: state(input.signals, false),
    corsRestricted: state(input.corsRestricted, false),
    trustedProxy: state(input.trustedProxy, false),
  };
}

function state(enabled: boolean, required: boolean): CapabilityState {
  return { enabled, required };
}
