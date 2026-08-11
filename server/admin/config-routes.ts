import type { Express, RequestHandler } from 'express';
import { readPendingConfig, validateConfigChange, writePendingConfig } from './config-store';
import type { AdminConfigEntry } from './config';
import type { AdminLogLevel } from './logs';
import type { OperationNonces } from './nonces';
import { secretFingerprint, validateSecretReplacement, writePendingSecret } from './secrets';

export interface AdminConfigRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  nonces: OperationNonces;
  inventory: () => AdminConfigEntry[];
  record: (entry: { time: number; level: AdminLogLevel; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void;
}

export function mountAdminConfigRoutes(deps: AdminConfigRoutesDeps): void {
  const { app, limit, requireAdmin, nonces, inventory, record } = deps;

  app.get('/admin/api/config', limit(30, 10), requireAdmin, async (_req, res) => {
    res.json({ ok: true, entries: inventory(), pending: await readPendingConfig() });
  });

  app.patch('/admin/api/config', limit(6, 2), requireAdmin, async (req, res) => {
    const key = typeof req.body?.key === 'string' ? req.body.key : '';
    const value = typeof req.body?.value === 'string' ? req.body.value : '';
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, `config.change:${key}`)) {
      res.status(409).json({ error: 'Missing or expired operation nonce.' });
      return;
    }
    const change = validateConfigChange(key, value);
    if (!change.ok) {
      res.status(400).json({ error: change.error });
      return;
    }
    const pending = await readPendingConfig();
    pending[change.key] = change.value;
    await writePendingConfig(pending);
    record({ time: Date.now(), level: 'info', subsystem: 'admin', event: 'config_changed', message: 'Configuration change staged for restart', context: { key: change.key, restartRequired: change.restartRequired, ip: req.ip } });
    res.json({ ok: true, key: change.key, pendingRestart: change.restartRequired });
  });

  app.post('/admin/api/secrets/:key/replace', limit(3, 1), requireAdmin, async (req, res) => {
    const key = String(req.params.key ?? '');
    const value = typeof req.body?.value === 'string' ? req.body.value : '';
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : '';
    if (!nonces.consume(nonce, `secret.replace:${key}`)) {
      res.status(409).json({ error: 'Missing or expired operation nonce.' });
      return;
    }
    const replacement = validateSecretReplacement(key, value);
    if (!replacement.ok) {
      res.status(400).json({ error: replacement.error });
      return;
    }
    await writePendingSecret(replacement.key, value);
    record({ time: Date.now(), level: 'info', subsystem: 'admin', event: 'secret_replaced', message: 'Secret replacement staged for restart', context: { key: replacement.key, newHash: secretFingerprint(value), ip: req.ip } });
    res.json({ ok: true, key: replacement.key, pendingRestart: true });
  });
}
