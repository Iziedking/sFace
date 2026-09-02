import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAtlasAssetManager } from '../src/atlas/assets/asset-manager';

describe('Atlas asset lifecycle', () => {
  it('loads a district once and unloads it only after the last owner releases it', async () => {
    const load = vi.fn(async () => undefined);
    const unload = vi.fn(async () => undefined);
    const assets = createAtlasAssetManager({ load, unload });
    await assets.acquire('pay-harbor');
    await assets.acquire('pay-harbor');
    await assets.release('pay-harbor');
    expect(unload).not.toHaveBeenCalled();
    await assets.release('pay-harbor');
    expect(load).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledWith('pay-harbor');
  });

  it('rejects releasing a bundle with no owner', async () => {
    const assets = createAtlasAssetManager({ load: vi.fn(async () => undefined), unload: vi.fn(async () => undefined) });
    await expect(assets.release('missing')).rejects.toThrow('not acquired');
  });

  it('rejects unsafe manifest metadata and integrity drift', () => {
    const root = mkdtempSync(join(tmpdir(), 'sface-atlas-assets-'));
    const publicRoot = join(root, 'public');
    const manifestPath = join(root, 'manifest.json');
    const iconPath = join(publicRoot, 'icon.svg');
    const manifest = {
      version: 1,
      mobileBudgetBytes: 262_144,
      assets: [{ id: 'icon', path: '/icon.svg', sha256: '3F48BEAD15FE087938B07F97FFD98BA844D1CDFDCB1E0C7BD1B1C7711B2DBE4D', bytes: 978, compressedBytes: 978, mime: 'image/svg+xml', width: 512, height: 512, bundle: 'shell' }],
    };
    mkdirSync(publicRoot, { recursive: true });
    copyFileSync('public/icon.svg', iconPath);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => execFileSync(process.execPath, ['scripts/verify-atlas-assets.mjs', '--manifest', manifestPath, '--public-root', publicRoot], { stdio: 'pipe' })).not.toThrow();
    for (const change of [
      { mime: 'application/x-secret' },
      { width: 4097 },
      { compressedBytes: 262_145 },
      { sha256: '0'.repeat(64) },
    ]) {
      const invalid = structuredClone(manifest);
      Object.assign(invalid.assets[0], change);
      writeFileSync(manifestPath, JSON.stringify(invalid));
      expect(() => execFileSync(process.execPath, ['scripts/verify-atlas-assets.mjs', '--manifest', manifestPath, '--public-root', publicRoot], { stdio: 'pipe' })).toThrow();
    }
  });
});
