import type { ParsedAtlasAssetManifest } from './manifest';

export type AtlasAssetQuality = 'mobile' | 'full';

export interface AtlasAssetAdapter {
  load(bundle: string, quality?: AtlasAssetQuality): Promise<void>;
  unload(bundle: string): Promise<void>;
}

export interface AtlasAssetManagerOptions {
  manifest?: ParsedAtlasAssetManifest;
  expectedManifestVersion?: number;
  fetcher?: typeof fetch;
  digest?: (bytes: ArrayBuffer) => Promise<string>;
}

export interface AtlasAssetManager {
  acquire(bundle: string, options?: { bandwidth?: 'low' | 'normal' }): Promise<void>;
  release(bundle: string): Promise<void>;
  references(bundle: string): number;
  loadedBundles(): string[];
  loadBytes(path: string): Promise<ArrayBuffer>;
}

export class AtlasAssetManifestStaleError extends Error {
  readonly code = 'manifest-stale';

  constructor() {
    super('Atlas asset manifest is stale.');
    this.name = 'AtlasAssetManifestStaleError';
  }
}

export class AtlasAssetBundleUnavailableError extends Error {
  readonly code = 'asset-unavailable';

  constructor(bundle: string) {
    super(`Atlas asset bundle ${bundle} is unavailable.`);
    this.name = 'AtlasAssetBundleUnavailableError';
  }
}

export class AtlasAssetIntegrityError extends Error {
  readonly code = 'asset-integrity-failed';

  constructor(path: string, reason: string) {
    super(`Atlas asset ${path} failed integrity verification: ${reason}.`);
    this.name = 'AtlasAssetIntegrityError';
  }
}

export function createAtlasAssetManager(adapter: AtlasAssetAdapter, options: AtlasAssetManagerOptions = {}): AtlasAssetManager {
  const counts = new Map<string, number>();
  return {
    async acquire(bundle: string, loadOptions: { bandwidth?: 'low' | 'normal' } = {}): Promise<void> {
      validateBundle(bundle, options);
      const count = counts.get(bundle) ?? 0;
      if (count === 0) {
        counts.set(bundle, 1);
        try {
          await adapter.load(bundle, loadOptions.bandwidth === 'low' ? 'mobile' : 'full');
        } catch (error) {
          counts.delete(bundle);
          if (error instanceof AtlasAssetManifestStaleError || error instanceof AtlasAssetBundleUnavailableError) throw error;
          throw new AtlasAssetBundleUnavailableError(bundle);
        }
        return;
      }
      counts.set(bundle, count + 1);
    },
    async release(bundle: string): Promise<void> {
      const count = counts.get(bundle) ?? 0;
      if (count <= 0) throw new Error(`Atlas asset bundle ${bundle} is not acquired.`);
      if (count === 1) {
        counts.delete(bundle);
        await adapter.unload(bundle);
      } else counts.set(bundle, count - 1);
    },
    references(bundle: string): number { return counts.get(bundle) ?? 0; },
    loadedBundles(): string[] { return [...counts.keys()].sort(); },
    async loadBytes(path: string): Promise<ArrayBuffer> {
      if (!path.startsWith('/atlas/') || path.includes('://') || path.split('/').includes('..')) {
        throw new AtlasAssetBundleUnavailableError(path);
      }
      const asset = options.manifest?.assets.find((entry) => entry.path === path);
      if (options.manifest && !asset) throw new AtlasAssetBundleUnavailableError(path);
      const response = await (options.fetcher ?? fetch)(path, { credentials: 'same-origin' });
      if (!response.ok) throw new AtlasAssetBundleUnavailableError(path);
      const bytes = await response.arrayBuffer();
      if (asset && bytes.byteLength !== asset.bytes) throw new AtlasAssetIntegrityError(path, 'byte count mismatch');
      const expectedHash = asset?.sha256;
      if (expectedHash) {
        const actualHash = await (options.digest ?? sha256)(bytes);
        if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) throw new AtlasAssetIntegrityError(path, 'SHA-256 mismatch');
      }
      return bytes;
    },
  };
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function validateBundle(bundle: string, options: AtlasAssetManagerOptions): void {
  if (!options.manifest) return;
  const expectedVersion = options.expectedManifestVersion ?? options.manifest.version;
  if (options.manifest.version !== expectedVersion) throw new AtlasAssetManifestStaleError();
  if (!options.manifest.assets.some((asset) => asset.bundle === bundle)) throw new AtlasAssetBundleUnavailableError(bundle);
}
