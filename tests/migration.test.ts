/**
 * The one write that replaces data with a shape that has never been on disk.
 *
 * Profiles used to hold their totals flat and now hold one set per chain.
 * `restore` reads both, so nothing is broken without a migration, and the file
 * converts itself the first time anybody posts a score. What the deliberate
 * migration buys is that the reading half stops being load-bearing: while an
 * old-shape file exists anywhere, that branch has to survive every future edit,
 * and deleting it as dead code would not throw. It would read every profile as
 * zeroes.
 *
 * So these cover the two halves that matter: the count that decides whether to
 * migrate at all, and the backup that has to exist before anything is
 * overwritten. A migration whose safety net is untested is a migration with no
 * safety net.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir = '';
let snapshotPath = '';

/**
 * A fresh DATA_DIR per case, imported fresh with it.
 *
 * server/store.ts reads DATA_DIR once at module load, so the env has to be set
 * before the import and the module registry reset between cases. Sharing one
 * directory would let a backup written by one test satisfy the next.
 */
async function loadStore() {
  process.env.DATA_DIR = dir;
  // resetModules, not a cache-busting query string: Vite hands the query to
  // esbuild as a loader name and the import fails before the test runs.
  vi.resetModules();
  return (await import('../server/store')) as typeof import('../server/store');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sface-migrate-'));
  snapshotPath = join(dir, 'sface.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FLAT = {
  version: 1,
  scores: [],
  challenges: [],
  mission: null,
  profiles: [
    { id: 'a'.repeat(64), name: 'Ada', lifetimeFace: 7_500, runs: 3, stagesCleared: 2 },
    { id: 'b'.repeat(64), name: 'Bo', network: 'test', lifetimeFace: 90_000, runs: 9 },
  ],
  ghosts: [],
  clans: [],
  signals: [],
};

describe('deciding whether to migrate', () => {
  it('counts records that arrived in the old flat shape', async () => {
    const profiles = await import('../server/profiles');
    profiles.restore(FLAT.profiles);

    expect(profiles.legacyCount()).toBe(2);
  });

  it('counts nothing once the file is already per-chain', async () => {
    const profiles = await import('../server/profiles');
    profiles.restore(FLAT.profiles);
    // The shape the migration writes. Reading it back must not look like more
    // work to do, or every boot rewrites the file and makes a new backup.
    profiles.restore(profiles.serialise() as unknown[]);

    expect(profiles.legacyCount()).toBe(0);
  });

  it('does not lose anything across the conversion', async () => {
    const profiles = await import('../server/profiles');
    profiles.restore(FLAT.profiles);
    profiles.restore(profiles.serialise() as unknown[]);

    expect(profiles.get('a'.repeat(64), 'main')?.lifetimeFace).toBe(7_500);
    expect(profiles.get('a'.repeat(64), 'main')?.stagesCleared).toBe(2);
    expect(profiles.get('b'.repeat(64), 'test')?.lifetimeFace).toBe(90_000);
    // The flat record said testnet, so mainnet stays empty rather than
    // inheriting a total nobody earned there.
    expect(profiles.get('b'.repeat(64), 'main')?.lifetimeFace).toBe(0);
  });
});

describe('the backup', () => {
  it('keeps the original before anything overwrites it', async () => {
    await writeFile(snapshotPath, JSON.stringify(FLAT), 'utf8');
    const store = await loadStore();

    const kept = await store.backupSnapshot('2026-08-01');
    expect(kept).not.toBeNull();
    expect(existsSync(kept!)).toBe(true);

    // Byte for byte, not merely present. A backup that is already the new
    // shape is not a backup.
    const copy = JSON.parse(await readFile(kept!, 'utf8'));
    expect(copy).toEqual(FLAT);
  });

  it('survives the migration writing over the live file', async () => {
    await writeFile(snapshotPath, JSON.stringify(FLAT), 'utf8');
    const store = await loadStore();

    const kept = await store.backupSnapshot('2026-08-01');
    await store.saveNow({
      version: 1,
      scores: [],
      challenges: [],
      mission: null,
    } as Parameters<typeof store.saveNow>[0]);

    const live = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const copy = JSON.parse(await readFile(kept!, 'utf8'));

    expect(live.profiles).toBeUndefined();
    expect(copy.profiles).toHaveLength(2);
  });

  it('reports success on a fresh install with no file to copy', async () => {
    // Nothing to lose is not a failure. Returning null here would refuse to
    // migrate a brand new deployment forever.
    const store = await loadStore();

    await expect(store.backupSnapshot('2026-08-01')).resolves.not.toBeNull();
  });
});

describe('the bucket holds numbers and nothing else', () => {
  /*
   * Found by reading a real migrated file rather than by reasoning about it.
   *
   * A flat record carries its identity in the same object as its totals, so
   * spreading it wholesale put id, name, clanTag and firstSeen inside the
   * progress bucket. `view` spreads that bucket last, so the stale copies won
   * over the account's real fields and a rename would silently revert.
   */
  it('keeps identity out of the per-chain totals', async () => {
    const profiles = await import('../server/profiles');
    profiles.restore(FLAT.profiles);

    const stored = profiles.serialise() as Array<{ chains: Record<string, object> }>;
    const bucket = stored[0]!.chains.main!;

    expect(Object.keys(bucket).sort()).toEqual([
      'bestScore',
      'caches',
      'extractions',
      'lifetimeFace',
      'relics',
      'rescued',
      'runs',
      'stagesCleared',
    ]);
  });

  it('does not let a stale name survive a rename', async () => {
    const profiles = await import('../server/profiles');
    profiles.restore(FLAT.profiles);

    profiles.record({
      id: 'a'.repeat(64),
      name: 'Ada Renamed',
      network: 'test',
      score: 10,
      rescued: 0,
      caches: 0,
      relics: 0,
      extracted: false,
      avatarUrl: null,
    });

    // The rename happened on testnet. Mainnet has not been flown since, so its
    // view is the one that would serve a stale copy if the bucket held one.
    expect(profiles.get('a'.repeat(64), 'main')?.name).toBe('Ada Renamed');
  });

  it('scrubs a file already migrated by the buggy version', async () => {
    const profiles = await import('../server/profiles');
    // What the first migration actually wrote to disk, junk and all.
    profiles.restore([
      {
        id: 'c'.repeat(64),
        name: 'Cy',
        chains: {
          main: { lifetimeFace: 100, name: 'Stale', id: 'wrong', clanTag: 'OLD' },
        },
      },
    ]);

    expect(profiles.get('c'.repeat(64), 'main')?.name).toBe('Cy');
    expect(profiles.get('c'.repeat(64), 'main')?.lifetimeFace).toBe(100);
  });
});
