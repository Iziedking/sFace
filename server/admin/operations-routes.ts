import type { Express, RequestHandler } from 'express';
import type { AdminLogBuffer, AdminLogLevel } from './logs';
import type { OperationNonces } from './nonces';
import type { DiagnosticBundle, DiagnosticInputs } from './diagnostics';
import type { EffectiveHealth } from './health';
import type { AdminConfigEntry } from './config';

export interface AdminOperationsDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  nonces: OperationNonces;
  backup: (label: string) => Promise<unknown>;
  listBackups: () => Promise<ReadonlyArray<{ name: string; sizeBytes: number; modifiedAt: number }>>;
  diagnostics: (input: DiagnosticInputs) => DiagnosticBundle;
  health: () => EffectiveHealth;
  config: () => AdminConfigEntry[];
  logs: AdminLogBuffer;
  record: (entry: { time: number; level: AdminLogLevel; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void;
  date: () => string;
  rateLimitCount: () => number;
  commit: string | null;
  restartSupported: boolean;
  restart: () => void;
}

export function isSupportedAdminOperation(operation: string): boolean {
  return ['backup.create', 'diagnostics.export', 'restart.request'].includes(operation) || operation.startsWith('secret.replace:') || operation.startsWith('config.change:');
}

export function mountAdminOperationsRoutes(deps: AdminOperationsDeps): void {
  const { app, limit, requireAdmin, nonces, backup, listBackups, diagnostics, health, config, logs, record, date, rateLimitCount, commit, restartSupported, restart } = deps;
  app.get('/admin/api/operations/nonce', limit(30, 10), requireAdmin, (req, res) => {
    const operation = typeof req.query.operation === 'string' ? req.query.operation : '';
    if (!isSupportedAdminOperation(operation)) { res.status(400).json({ error: 'Unsupported operation.' }); return; }
    res.json({ ok: true, nonce: nonces.issue(operation) });
  });
  app.get('/admin/api/backups', limit(30, 10), requireAdmin, async (_req, res) => { res.json({ ok: true, backups: await listBackups() }); });
  app.post('/admin/api/backups', limit(3, 1), requireAdmin, async (req, res) => {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, 'backup.create')) { res.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    const result = await backup('admin-' + date() + '-' + Date.now());
    if (!result) { record({ time: Date.now(), level: 'error', subsystem: 'persistence', event: 'backup_failed', message: 'Admin backup failed' }); res.status(503).json({ error: 'Backup failed.' }); return; }
    record({ time: Date.now(), level: 'info', subsystem: 'persistence', event: 'backup_created', message: 'Admin backup created' });
    res.json({ ok: true });
  });
  app.post('/admin/api/restart', limit(2, 1), requireAdmin, (req, res) => {
    if (!restartSupported) { res.status(503).json({ error: 'Supervisor restart is not enabled.' }); return; }
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, 'restart.request')) { res.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    record({ time: Date.now(), level: 'warn', subsystem: 'admin', event: 'restart_requested', message: 'Graceful supervisor restart requested', context: { ip: req.ip } });
    res.json({ ok: true, disconnectExpected: true });
    res.on('finish', restart);
  });
  app.post('/admin/api/diagnostics/export', limit(3, 1), requireAdmin, (req, res) => {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, 'diagnostics.export')) { res.status(409).json({ error: 'Missing or expired operation nonce.' }); return; }
    const effective = health();
    const bundle = diagnostics({ generatedAt: Date.now(), commit, persistence: effective.persistence, capabilities: effective.capabilities, config: config(), logs: logs.list(Date.now(), 1_000), rateLimitBuckets: rateLimitCount() });
    record({ time: Date.now(), level: 'info', subsystem: 'admin', event: 'diagnostics_exported', message: 'Redacted diagnostics exported', context: { ip: req.ip } });
    res.setHeader('content-disposition', `attachment; filename="sface-diagnostics-${date()}.json"`);
    res.json(bundle);
  });
}
