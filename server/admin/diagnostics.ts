import type { AdminConfigEntry } from './config';
import type { AdminLogEntry } from './logs';
import type { PersistenceHealth } from '../store';
import type { Capabilities } from '../capabilities';

export interface DiagnosticInputs {
  generatedAt: number;
  commit: string | null;
  persistence: PersistenceHealth;
  capabilities: Capabilities;
  config: AdminConfigEntry[];
  logs: AdminLogEntry[];
  rateLimitBuckets: number;
}

export interface DiagnosticBundle extends DiagnosticInputs {
  schema: 'sface.admin-diagnostics.v1';
}

export function buildDiagnosticBundle(input: DiagnosticInputs): DiagnosticBundle {
  return {
    schema: 'sface.admin-diagnostics.v1',
    generatedAt: input.generatedAt,
    commit: input.commit,
    persistence: input.persistence,
    capabilities: input.capabilities,
    config: input.config,
    logs: input.logs,
    rateLimitBuckets: input.rateLimitBuckets,
  };
}
