import type { Express, RequestHandler } from 'express';
import type { AdminLogBuffer, AdminLogLevel } from './logs';

export interface AdminObservabilityDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  logs: AdminLogBuffer;
  record: (entry: { time: number; level: AdminLogLevel; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void;
}

export function mountAdminObservabilityRoutes(deps: AdminObservabilityDeps): void {
  const { app, limit, requireAdmin, logs, record } = deps;
  app.post('/admin/api/login/check', limit(5, 3), requireAdmin, (req, res) => {
    record({ time: Date.now(), level: 'info', subsystem: 'admin', event: 'login_success', message: 'Admin login accepted', context: { ip: req.ip } });
    res.json({ ok: true });
  });
  app.get('/admin/api/logs', limit(30, 10), requireAdmin, (req, res) => {
    const limitValue = Number(req.query.limit ?? 200);
    const level = ['info', 'warn', 'error'].includes(String(req.query.level ?? '')) ? String(req.query.level) as AdminLogLevel : undefined;
    res.json({ ok: true, entries: logs.list(Date.now(), Number.isFinite(limitValue) ? limitValue : 200, { level, subsystem: typeof req.query.subsystem === 'string' ? req.query.subsystem : undefined, event: typeof req.query.event === 'string' ? req.query.event : undefined }) });
  });
  app.get('/admin/api/logs/stream', limit(12, 4), requireAdmin, (req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('connection', 'keep-alive');
    res.flushHeaders();
    res.write(': connected\n\n');
    const unsubscribe = logs.subscribe((entry) => res.write('event: log\ndata: ' + JSON.stringify(entry) + '\n\n'));
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
    heartbeat.unref?.();
    req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
}
