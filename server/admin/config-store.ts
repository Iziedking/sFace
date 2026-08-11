import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const CONFIG_PATH = join(process.env.DATA_DIR ?? join(process.cwd(), '.data'), 'admin-config.pending.json');
const DEFINITIONS: Record<string, { secret: boolean; restartRequired: boolean }> = {
  ADMIN_ALLOWED_IPS: { secret: false, restartRequired: true },
  ALLOWED_ORIGINS: { secret: false, restartRequired: true },
  TRUST_PROXY: { secret: false, restartRequired: true },
  ANCHOR_ADDRESS: { secret: false, restartRequired: true },
  SFACE_TREASURY: { secret: false, restartRequired: true },
  SIGNALS_PRICE_NIM: { secret: false, restartRequired: true },
  GIT_COMMIT: { secret: false, restartRequired: false },
  ADMIN_TOKEN: { secret: true, restartRequired: true },
  X_CLIENT_ID: { secret: true, restartRequired: true },
  X_CLIENT_SECRET: { secret: true, restartRequired: true },
  X_BEARER_TOKEN: { secret: true, restartRequired: true },
  XAI_API_KEY: { secret: true, restartRequired: true },
};

export type ConfigChangeResult =
  | { ok: true; key: string; value: string; restartRequired: boolean }
  | { ok: false; error: 'unknown_key' | 'secret_key_requires_replacement' | 'invalid_value' };

export function validateConfigChange(key: string, value: string): ConfigChangeResult {
  const definition = DEFINITIONS[key];
  if (!definition) return { ok: false, error: 'unknown_key' };
  if (definition.secret) return { ok: false, error: 'secret_key_requires_replacement' };
  if (value.length > 4_096 || /[\u0000\r\n]/.test(value)) return { ok: false, error: 'invalid_value' };
  if (key === 'TRUST_PROXY' && value !== 'true' && value !== 'false') return { ok: false, error: 'invalid_value' };
  if (key === 'SIGNALS_PRICE_NIM' && (!/^\d+(\.\d+)?$/.test(value) || Number(value) < 0)) return { ok: false, error: 'invalid_value' };
  return { ok: true, key, value, restartRequired: definition.restartRequired };
}

export async function readPendingConfig(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => DEFINITIONS[key] && typeof value === 'string'));
  } catch {
    return {};
  }
}

export async function writePendingConfig(values: Record<string, string>): Promise<void> {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(values), 'utf8');
  await rename(temp, CONFIG_PATH);
}
