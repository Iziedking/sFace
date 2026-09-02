import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST_PATH = join(SCRIPT_ROOT, 'public', 'atlas', 'manifests', 'assets-v1.json');
const DEFAULT_PUBLIC_ROOT = join(SCRIPT_ROOT, 'public');
const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'audio/mpeg', 'audio/ogg', 'font/woff2', 'application/json', 'model/gltf-binary']);
const MAX_DIMENSION = 4096;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validateAtlasAssetManifest(manifest, publicRoot = DEFAULT_PUBLIC_ROOT) {
  const errors = [];
  if (!manifest || (manifest.version !== 1 && manifest.version !== 2)) errors.push('manifest version must be 1 or 2');
  if (!Number.isSafeInteger(manifest?.mobileBudgetBytes) || manifest.mobileBudgetBytes <= 0) errors.push('mobile budget must be a positive integer');
  if (!Array.isArray(manifest?.assets) || manifest.assets.length === 0) errors.push('manifest assets must be a non-empty array');
  const ids = new Set();
  const hashes = new Set();
  for (const asset of manifest?.assets ?? []) {
    if (!asset || typeof asset !== 'object') {
      errors.push('asset entry must be an object');
      continue;
    }
    if (!asset.id || ids.has(asset.id)) errors.push(`asset id is missing or duplicated: ${asset.id ?? '<missing>'}`);
    ids.add(asset.id);
    if (!SUPPORTED_MIME.has(asset.mime)) errors.push(`${asset.id}: unsupported MIME type`);
    if (!Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width <= 0 || asset.height <= 0 || asset.width > MAX_DIMENSION || asset.height > MAX_DIMENSION) errors.push(`${asset.id}: dimensions exceed the 4096px limit or are invalid`);
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !Number.isSafeInteger(asset.compressedBytes) || asset.compressedBytes < 0 || asset.compressedBytes > (manifest.mobileBudgetBytes ?? 0)) errors.push(`${asset.id}: byte metadata exceeds the mobile budget or is invalid`);
    if (!/^[a-f0-9]{64}$/i.test(asset.sha256)) errors.push(`${asset.id}: SHA-256 is invalid`);
    if (hashes.has(asset.sha256)) errors.push(`${asset.id}: duplicate content hash`);
    hashes.add(asset.sha256);
    const relativePath = typeof asset.path === 'string' ? asset.path.replace(/^\/+/, '') : '';
    const filePath = resolve(publicRoot, relativePath);
    if (!relativePath || isAbsolute(relativePath) || relative(publicRoot, filePath).startsWith('..') || !existsSync(filePath)) {
      errors.push(`${asset.id}: asset file is missing or outside public root`);
      continue;
    }
    const bytes = readFileSync(filePath);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== asset.bytes) errors.push(`${asset.id}: byte size mismatch`);
    if (actualHash.toLowerCase() !== asset.sha256.toLowerCase()) errors.push(`${asset.id}: SHA-256 mismatch`);
    if (manifest.version === 2 && asset.mime === 'model/gltf-binary') {
      if (asset.sourceStatus !== 'owner-approved-procedural') errors.push(`${asset.id}: procedural approval is missing`);
      if (!Array.isArray(asset.quality) || asset.quality.length === 0) errors.push(`${asset.id}: quality profiles are missing`);
      if (typeof asset.sourceFile !== 'string' || typeof asset.sourceSha256 !== 'string') errors.push(`${asset.id}: source evidence is missing`);
      if (typeof asset.sourceFile === 'string' && typeof asset.sourceSha256 === 'string') {
        const sourcePath = resolve(SCRIPT_ROOT, asset.sourceFile);
        if (!asset.sourceFile.startsWith('art/atlas/') || relative(SCRIPT_ROOT, sourcePath).startsWith('..') || !existsSync(sourcePath)) {
          errors.push(`${asset.id}: source file is outside art/atlas or missing`);
        } else {
          const sourceHash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
          if (sourceHash.toLowerCase() !== asset.sourceSha256.toLowerCase()) errors.push(`${asset.id}: source SHA-256 mismatch`);
        }
      }
      if (asset.path.includes('review') || asset.id.includes('review')) errors.push(`${asset.id}: review-only art cannot be runtime asset`);
    }
    if (!statSync(filePath).isFile()) errors.push(`${asset.id}: asset path is not a file`);
  }
  if (errors.length > 0) throw new Error(`Atlas asset manifest invalid:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  return true;
}

export function validateAtlasArtSource(sourceRoot) {
  const provenancePath = join(sourceRoot, 'licenses.json');
  if (!existsSync(provenancePath)) throw new Error('Atlas art provenance file is missing.');
  const records = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (!Array.isArray(records) || records.length === 0) throw new Error('Atlas art provenance must be a non-empty array.');
  const ids = new Set();
  const hashes = new Set();
  for (const record of records) {
    const required = ['id', 'authorOrTool', 'creationDate', 'sourceFile', 'license', 'consentStatus'];
    if (!record || required.some((field) => typeof record[field] !== 'string' || record[field].trim() === '') || typeof record.realPersonLikeness !== 'boolean' || typeof record.approvedDerivativeUse !== 'boolean') throw new Error('Atlas art provenance has an incomplete record.');
    if (ids.has(record.id)) throw new Error(`Atlas art provenance id is duplicated: ${record.id}`);
    ids.add(record.id);
    if (record.realPersonLikeness) throw new Error(`${record.id}: real-person likeness is not approved.`);
    const sourceFile = resolve(SCRIPT_ROOT, record.sourceFile);
    if (!record.sourceFile.startsWith('art/atlas/') || relative(SCRIPT_ROOT, sourceFile).startsWith('..') || !existsSync(sourceFile) || !statSync(sourceFile).isFile()) throw new Error(`${record.id}: provenance source file is missing or outside art/atlas.`);
    const bytes = readFileSync(sourceFile);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hashes.has(hash)) throw new Error(`${record.id}: duplicate art content hash.`);
    hashes.add(hash);
    if (record.sourceFile.endsWith('.png')) {
      if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error(`${record.id}: art file is not a PNG.`);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error(`${record.id}: PNG dimensions exceed the 4096px limit.`);
    } else if (record.sourceFile.endsWith('.svg')) {
      const svg = bytes.toString('utf8');
      const viewBox = svg.match(/<svg\b[^>]*\bviewBox=["']\s*0\s+0\s+(\d+)\s+(\d+)["']/i);
      const width = Number(viewBox?.[1] ?? 0);
      const height = Number(viewBox?.[2] ?? 0);
      if (!svg.trimStart().startsWith('<svg') || width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new Error(`${record.id}: SVG signature or dimensions are invalid.`);
      if (/<script\b|\bon\w+\s*=|(?:href|xlink:href)\s*=\s*["'](?:javascript:|data:|https?:)/i.test(svg)) throw new Error(`${record.id}: SVG contains executable or external content.`);
    } else throw new Error(`${record.id}: unsupported art source type.`);
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const source = process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : null;
  const manifestArgument = process.argv.includes('--manifest') ? process.argv[process.argv.indexOf('--manifest') + 1] : null;
  const publicRootArgument = process.argv.includes('--public-root') ? process.argv[process.argv.indexOf('--public-root') + 1] : null;
  if (source && !manifestArgument) {
    validateAtlasArtSource(resolve(source));
    console.log(`Atlas art provenance valid: ${JSON.parse(readFileSync(join(resolve(source), 'licenses.json'), 'utf8')).length} assets.`);
  } else {
    const manifestPath = manifestArgument ? resolve(manifestArgument) : DEFAULT_MANIFEST_PATH;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    validateAtlasAssetManifest(manifest, publicRootArgument ? resolve(publicRootArgument) : DEFAULT_PUBLIC_ROOT);
    console.log(`Atlas asset manifest valid: ${manifest.assets.length} assets.`);
  }
}
