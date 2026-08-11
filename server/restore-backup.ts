import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseSnapshot } from './store';

export function validBackupName(value: string): boolean {
  return basename(value) === value && /^sface\.json\.[A-Za-z0-9._-]+\.bak$/.test(value);
}

export async function restoreBackup(dataDir: string, backupName: string): Promise<{ restored: string; previous: string | null }> {
  if (!validBackupName(backupName)) throw new Error('Backup name is not allowed.');
  const backupPath = join(dataDir, backupName);
  const snapshotPath = join(dataDir, 'sface.json');
  const raw = await readFile(backupPath, 'utf8');
  const parsed = parseSnapshot(raw);
  if (!parsed.ok) throw new Error(`Backup validation failed: ${parsed.error}.`);
  const previous = `${snapshotPath}.before-restore-${Date.now()}.bak`;
  let previousResult: string | null = previous;
  try { await copyFile(snapshotPath, previous); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') previousResult = null;
    else throw error;
  }
  const temp = `${snapshotPath}.${process.pid}.restore.tmp`;
  await writeFile(temp, raw, 'utf8');
  await rename(temp, snapshotPath);
  return { restored: backupPath, previous: previousResult };
}
