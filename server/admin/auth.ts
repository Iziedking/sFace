import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface AdminAuthConfig {
  token: string;
  allowedIps: readonly string[];
}

export function adminConfig(env: Readonly<Record<string, string | undefined>> = process.env): AdminAuthConfig {
  return {
    token: env.ADMIN_TOKEN?.trim() ?? '',
    allowedIps: (env.ADMIN_ALLOWED_IPS ?? '').split(',').map((ip) => ip.trim()).filter(Boolean),
  };
}

export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented || !expected) return false;
  const left = createHash('sha256').update(presented).digest();
  const right = createHash('sha256').update(expected).digest();
  return timingSafeEqual(left, right);
}

export function adminMiddleware(config: AdminAuthConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('cache-control', 'no-store');
    if (!config.token || (config.allowedIps.length > 0 && !config.allowedIps.includes(req.ip ?? ''))) {
      res.status(401).json({ error: 'Admin access denied.' });
      return;
    }
    const header = req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!tokenMatches(presented, config.token)) {
      res.status(401).json({ error: 'Admin access denied.' });
      return;
    }
    next();
  };
}
