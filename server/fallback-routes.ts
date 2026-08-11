import type { Express, NextFunction, Request, Response } from 'express';
import type { AdminLogLevel } from './admin/logs';

export function installFallbackRoutes(app: Express, record: (entry: { time: number; level: AdminLogLevel; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void): void {
  app.use((_req, res) => { res.status(404).json({ error: 'No such endpoint.' }); });
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    record({ time: Date.now(), level: 'error', subsystem: 'http', event: 'unhandled_error', message: 'Unhandled request error', context: { method: req.method, path: req.path, error: error instanceof Error ? error.message : String(error) } });
    res.status(500).json({ error: 'Something broke on our side.' });
  });
}
