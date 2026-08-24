import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface LegacyModeConfig {
  publicExperience: 'relay' | 'legacy';
  publicEnabled: boolean;
  writesEnabled: boolean;
  adminReadsEnabled: boolean;
}

export type LegacyMutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 410; error: 'legacy_experience_archived' };

const ARCHIVED_RESPONSE = {
  error: 'legacy_experience_archived' as const,
};

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === 'true';
}

export function legacyConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LegacyModeConfig {
  return {
    publicExperience: env.PUBLIC_EXPERIENCE?.trim() === 'legacy' ? 'legacy' : 'relay',
    publicEnabled: flag(env.LEGACY_PUBLIC_ENABLED, false),
    writesEnabled: flag(env.LEGACY_WRITES_ENABLED, false),
    adminReadsEnabled: flag(env.LEGACY_ADMIN_READS_ENABLED, true),
  };
}

export function runLegacyMutation<T>(
  config: LegacyModeConfig,
  mutation: () => T,
): LegacyMutationResult<T> {
  if (!config.writesEnabled) return { ok: false, status: 410, ...ARCHIVED_RESPONSE };
  return { ok: true, value: mutation() };
}

export function legacyMutationMiddleware(config: LegacyModeConfig): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!config.writesEnabled) {
      res.status(410).json(ARCHIVED_RESPONSE);
      return;
    }
    next();
  };
}
