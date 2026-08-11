import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { AdminLogLevel } from './admin/logs';

export interface RequestLogDeps {
  record: (entry: { time: number; level: AdminLogLevel; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void;
}

export function installRequestLogging(app: Express, deps: RequestLogDeps): void {
  app.use((req: Request, res: Response, next) => {
    const supplied = req.header('x-request-id') ?? '';
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
    const started = Date.now();
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      const status = res.statusCode;
      const level: AdminLogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      deps.record({
        time: Date.now(),
        level,
        subsystem: 'http',
        event: 'request_completed',
        message: `${req.method} ${req.path} ${status}`,
        context: { requestId, method: req.method, path: req.path, status, durationMs: Date.now() - started, ip: req.ip },
      });
    });
    next();
  });
}
