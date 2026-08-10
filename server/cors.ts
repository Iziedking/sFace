export interface CorsDecision {
  allowed: boolean;
  header: string | null;
}

export function parseAllowedOrigins(raw: string, production: boolean): string[] {
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (production && origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one origin in production.');
  }
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
    }
  }
  return origins;
}

export function corsDecision(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  production: boolean,
): CorsDecision {
  if (!origin) return { allowed: true, header: null };
  if (allowedOrigins.includes(origin)) return { allowed: true, header: origin };
  if (!production && allowedOrigins.length === 0) return { allowed: true, header: '*' };
  return { allowed: false, header: null };
}
