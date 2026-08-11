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

export type AdminDenialReason = 'admin_unconfigured' | 'ip_denied' | 'token_denied';
export type AdminDenialRecorder = (event: { reason: AdminDenialReason; ip: string; path: string }) => void;

export function adminMiddleware(config: AdminAuthConfig, recordDenial?: AdminDenialRecorder) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('cache-control', 'no-store');
    const ip = req.ip ?? '';
    if (!config.token) {
      recordDenial?.({ reason: 'admin_unconfigured', ip, path: req.path });
      res.status(401).json({ error: 'Admin access denied.' });
      return;
    }
    if (config.allowedIps.length > 0 && !config.allowedIps.includes(ip)) {
      recordDenial?.({ reason: 'ip_denied', ip, path: req.path });
      res.status(401).json({ error: 'Admin access denied.' });
      return;
    }
    const header = req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!tokenMatches(presented, config.token)) {
      recordDenial?.({ reason: 'token_denied', ip, path: req.path });
      res.status(401).json({ error: 'Admin access denied.' });
      return;
    }
    next();
  };
}
