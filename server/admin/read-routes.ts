import type { Express, RequestHandler } from 'express';
import { isAuditEvent } from './audit';
import type { AdminLogBuffer, AdminLogLevel } from './logs';
import { adminRecord, type AdminRecordSources } from './records';

export interface AdminReadRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  logs: AdminLogBuffer;
  record: (entry: { time: number; level: AdminLogLevel; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void;
  sources: AdminRecordSources;
}

export function mountAdminReadRoutes(deps: AdminReadRoutesDeps): void {
  const { app, limit, requireAdmin, logs, record, sources } = deps;

  app.get('/admin/api/audit', limit(30, 10), requireAdmin, (_req, res) => {
    res.json({ ok: true, entries: logs.list(Date.now(), 1_000).filter((entry) => isAuditEvent(entry.event)) });
  });

  app.get('/admin/api/records/:kind', limit(30, 10), requireAdmin, (req, res) => {
    const result = adminRecord(String(req.params.kind ?? ''), sources);
    if (!result.ok) {
      res.status(result.error === 'unknown_record_kind' ? 404 : 503).json({ error: result.error });
      return;
    }
    record({ time: Date.now(), level: 'info', subsystem: 'admin', event: 'records_read', message: 'Admin records viewed', context: { kind: result.kind, ip: req.ip } });
    res.json(result);
  });
}
