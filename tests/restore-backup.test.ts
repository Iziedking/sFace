import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreBackup, validBackupName } from '../server/restore-backup';

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('backup restoration boundary', () => {
  it('accepts only controlled backup filenames', () => {
    expect(validBackupName('sface.json.admin-2026-08-11-123.bak')).toBe(true);
    expect(validBackupName('../sface.json.admin.bak')).toBe(false);
    expect(validBackupName('other.json.admin.bak')).toBe(false);
  });

  it('validates and atomically restores a snapshot while preserving the current one', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'sface-restore-'));
    created.push(dataDir);
    const current = JSON.stringify({ version: 1, scores: ['current'], challenges: {}, mission: {} });
    const backup = JSON.stringify({ version: 1, scores: ['backup'], challenges: {}, mission: {} });
    await writeFile(join(dataDir, 'sface.json'), current, 'utf8');
    await writeFile(join(dataDir, 'sface.json.admin-test.bak'), backup, 'utf8');
    const result = await restoreBackup(dataDir, 'sface.json.admin-test.bak');
    expect(await readFile(join(dataDir, 'sface.json'), 'utf8')).toBe(backup);
    expect(result.previous).not.toBeNull();
    expect(await readFile(result.previous!, 'utf8')).toBe(current);
  });

  it('refuses a corrupt backup before replacing live state', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'sface-restore-'));
    created.push(dataDir);
    const current = JSON.stringify({ version: 1, scores: [], challenges: {}, mission: {} });
    await writeFile(join(dataDir, 'sface.json'), current, 'utf8');
    await writeFile(join(dataDir, 'sface.json.bad.bak'), '{broken', 'utf8');
    await expect(restoreBackup(dataDir, 'sface.json.bad.bak')).rejects.toThrow('snapshot_corrupt');
    expect(await readFile(join(dataDir, 'sface.json'), 'utf8')).toBe(current);
  });
});
