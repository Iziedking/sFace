import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_KEYS = new Set(['ALLOWED_ORIGINS', 'TRUST_PROXY', 'ANCHOR_ADDRESS', 'SFACE_TREASURY', 'SIGNALS_PRICE_NIM', 'GIT_COMMIT']);
const SECRET_KEYS = new Set(['ADMIN_TOKEN', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_BEARER_TOKEN', 'XAI_API_KEY']);

export function mergeStartupConfig(
  current: Readonly<Record<string, string | undefined>>,
  pending: Readonly<Record<string, string>>,
): Record<string, string | undefined> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(pending)) {
    if (CONFIG_KEYS.has(key) || SECRET_KEYS.has(key)) merged[key] = value;
  }
  return merged;
}

export function applyPendingStartupConfig(): string[] {
  const dataDir = process.env.DATA_DIR ?? join(process.cwd(), '.data');
  const paths = [
    join(dataDir, 'admin-config.pending.json'),
    join(dataDir, 'admin-secrets.pending.json'),
  ];
  const pending: Record<string, string> = {};
  const found: string[] = [];

  for (const path of paths) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object') throw new Error(`Pending admin file is not an object: ${path}`);
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') pending[key] = value;
      }
      found.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  const merged = mergeStartupConfig(process.env, pending);
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const path of found) unlinkSync(path);
  return Object.keys(pending).filter((key) => CONFIG_KEYS.has(key) || SECRET_KEYS.has(key));
}
