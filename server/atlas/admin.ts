import type { Express, RequestHandler } from 'express';

export interface AtlasAdminRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  evidence: () => unknown;
}

export function mountAtlasAdminRoutes(deps: AtlasAdminRoutesDeps): void {
  deps.app.get('/admin/api/atlas/evidence', deps.limit(30, 10), deps.requireAdmin, (_request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: maskAtlasAdminEvidence(deps.evidence()) });
  });
}

export function maskAtlasAdminEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskAtlasAdminEvidence);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const masked = { ...record };
  for (const key of ['actorId', 'walletAddress', 'sender', 'recipient', 'lookup', 'transactionHash']) {
    if (typeof masked[key] === 'string') masked[key] = maskToken(masked[key]);
  }
  return masked;
}

function maskToken(value: string): string {
  if (value.length <= 8) return '...';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
