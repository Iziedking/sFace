import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildLegacyManifest, resolveLegacyArchivePath } from '../server/legacy/manifest';

const dataDirectory = resolve(process.env.DATA_DIR ?? join(process.cwd(), '.data'));
const sourcePath = resolve(dataDirectory, 'sface.json');
const archiveDirectory = resolve(dataDirectory, 'legacy-archive');
const args = new Set(process.argv.slice(2));

if (args.has('--help')) {
  process.stdout.write('Usage: tsx scripts/archive-legacy.ts [--write-manifest] [--backup]\n');
  process.exit(0);
}

const manifest = await buildLegacyManifest(sourcePath);

if (args.has('--write-manifest') || args.has('--backup')) {
  await mkdir(archiveDirectory, { recursive: true });
}

if (args.has('--write-manifest')) {
  const manifestPath = resolveLegacyArchivePath(dataDirectory, join(archiveDirectory, 'manifest.json'));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

if (args.has('--backup')) {
  const stamp = new Date().toISOString().replace(/[.:]/g, '-');
  const backupPath = resolveLegacyArchivePath(dataDirectory, join(archiveDirectory, `sface.json.${stamp}.bak`));
  await copyFile(sourcePath, backupPath);
}

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
