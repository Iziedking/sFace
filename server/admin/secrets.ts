import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SECRET_KEYS = new Set(['ADMIN_TOKEN', 'X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_BEARER_TOKEN', 'XAI_API_KEY']);
const SECRET_PATH = join(process.env.DATA_DIR ?? join(process.cwd(), '.data'), 'admin-secrets.pending.json');

export type SecretReplacementResult =
  | { ok: true; key: string }
  | { ok: false; error: 'unknown_secret' | 'invalid_secret' };

export function validateSecretReplacement(key: string, value: string): SecretReplacementResult {
  if (!SECRET_KEYS.has(key)) return { ok: false, error: 'unknown_secret' };
  const minimum = key === 'ADMIN_TOKEN' ? 32 : 8;
  if (value.length < minimum || value.length > 4_096 || /[\u0000\r\n]/.test(value)) {
    return { ok: false, error: 'invalid_secret' };
  }
  return { ok: true, key };
}

export function secretFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function writePendingSecret(key: string, value: string): Promise<void> {
  let pending: Record<string, string> = {};
  try {
    pending = JSON.parse(await readFile(SECRET_PATH, 'utf8')) as Record<string, string>;
  } catch {
    pending = {};
  }
  pending[key] = value;
  await mkdir(dirname(SECRET_PATH), { recursive: true });
  const temp = `${SECRET_PATH}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(pending), { encoding: 'utf8', mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, SECRET_PATH);
}
