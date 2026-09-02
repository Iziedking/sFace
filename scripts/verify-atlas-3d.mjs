import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith('--')) args.set(value, process.argv[index + 1] ?? true);
}

const manifestPath = typeof args.get('--manifest') === 'string' ? args.get('--manifest') : 'public/atlas/manifests/assets-v2.json';
const district = typeof args.get('--district') === 'string' ? args.get('--district') : undefined;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.version !== 2 || !Array.isArray(manifest.assets)) throw new Error('Atlas 3D verifier requires an assets-v2 manifest.');

const ids = new Set();
const checked = [];
for (const asset of manifest.assets) {
  if (ids.has(asset.id)) throw new Error(`Duplicate asset id: ${asset.id}`);
  ids.add(asset.id);
  if (asset.mime === 'model/gltf-binary') {
    if (asset.sourceStatus !== 'owner-approved-procedural') throw new Error(`3D asset ${asset.id} lacks approved procedural provenance.`);
    if (!Array.isArray(asset.quality) || asset.quality.length === 0) throw new Error(`3D asset ${asset.id} lacks quality profiles.`);
    if (typeof asset.sourceFile !== 'string' || typeof asset.sourceSha256 !== 'string') throw new Error(`3D asset ${asset.id} lacks source evidence.`);
  }
  if (asset.mime !== 'model/gltf-binary' && asset.mime !== 'application/json') continue;
  const required = Boolean(args.has('--all') || district);
  const localPath = `public${asset.path}`;
  try {
    const bytes = await readFile(localPath);
    if (bytes.length !== asset.bytes) throw new Error(`byte count mismatch, expected ${asset.bytes}, got ${bytes.length}`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== asset.sha256.toLowerCase()) throw new Error('SHA-256 mismatch');
    if (asset.mime === 'model/gltf-binary') {
      const glb = parseGlb(bytes);
      const sourceHash = createHash('sha256').update(await readFile(asset.sourceFile)).digest('hex');
      if (sourceHash !== asset.sourceSha256.toLowerCase()) throw new Error('procedural source SHA-256 mismatch');
      const metrics = inspectGlb(glb.document, glb.binary);
      verifyBudget(asset.id, metrics);
      checked.push({ id: asset.id, bytes: bytes.length, sha256: hash, ...metrics });
    } else {
      const scene = JSON.parse(bytes.toString('utf8'));
      verifyScene(scene, district);
      checked.push({ id: asset.id, bytes: bytes.length, sha256: hash, anchors: scene.anchors?.length ?? 0, paths: scene.paths?.length ?? 0 });
    }
  } catch (error) {
    if (required) throw new Error(`Unable to verify ${asset.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

console.log(JSON.stringify({ manifest: manifestPath, version: manifest.version, district: district ?? null, checked }, null, 2));

function parseGlb(bytes) {
  if (bytes.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error('GLB magic is invalid');
  if (bytes.readUInt32LE(4) !== 2) throw new Error('GLB version is not 2');
  if (bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB declared length is invalid');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.subarray(16, 20).toString('ascii') !== 'JSON') throw new Error('GLB JSON chunk is missing');
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  const document = JSON.parse(bytes.subarray(jsonStart, jsonEnd).toString('utf8'));
  const binaryLength = bytes.readUInt32LE(jsonEnd);
  if (bytes.subarray(jsonEnd + 4, jsonEnd + 8).toString('ascii') !== 'BIN\u0000') throw new Error('GLB BIN chunk is missing');
  const binaryStart = jsonEnd + 8;
  if (binaryStart + binaryLength !== bytes.length) throw new Error('GLB BIN chunk length is invalid');
  return { document, binary: bytes.subarray(binaryStart, binaryStart + binaryLength) };
}

function inspectGlb(document, binary) {
  if (document.buffers?.some((buffer) => buffer.uri)) throw new Error('External GLB buffers are not allowed');
  if (document.images || document.textures) throw new Error('External or embedded textures are not allowed');
  const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  const typeWidth = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  for (const view of document.bufferViews ?? []) {
    const offset = view.byteOffset ?? 0;
    if (offset < 0 || offset + view.byteLength > binary.length) throw new Error('GLB bufferView is outside the BIN chunk');
  }
  for (const accessor of document.accessors ?? []) {
    const view = document.bufferViews[accessor.bufferView];
    if (!view || !componentBytes[accessor.componentType] || !typeWidth[accessor.type]) throw new Error('GLB accessor is malformed');
    const required = (accessor.byteOffset ?? 0) + accessor.count * componentBytes[accessor.componentType] * typeWidth[accessor.type];
    if (required > view.byteLength) throw new Error('GLB accessor exceeds its bufferView');
  }
  let triangles = 0;
  let vertices = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error('Only triangle-list GLB primitives are allowed');
      const position = document.accessors[primitive.attributes?.POSITION];
      if (!position) throw new Error('GLB primitive has no POSITION accessor');
      vertices += position.count;
      triangles += primitive.indices === undefined ? position.count / 3 : document.accessors[primitive.indices].count / 3;
    }
  }
  return { triangles, vertices, materials: document.materials?.length ?? 0, meshes: document.meshes?.length ?? 0, animations: document.animations?.length ?? 0 };
}

function verifyBudget(id, metrics) {
  const triangleLimit = id === 'atlas-walker-player' ? 5200 : id === 'atlas-walker-npc-lod1' ? 3300 : id === 'atlas-walker-npc-lod2' ? 800 : 120000;
  if (metrics.triangles > triangleLimit) throw new Error(`triangle budget exceeded: ${metrics.triangles} > ${triangleLimit}`);
  const materialLimit = id === 'pay-harbor-environment' ? 8 : id.startsWith('atlas-walker') ? 8 : 12;
  if (metrics.materials > materialLimit) throw new Error(`material budget exceeded: ${metrics.materials} > ${materialLimit}`);
  if (id.startsWith('atlas-walker') && metrics.animations !== 3) throw new Error(`character animation set is incomplete: ${metrics.animations} != 3`);
}

function verifyScene(scene, expectedDistrict) {
  if (scene.version !== 1 || typeof scene.districtId !== 'string') throw new Error('scene JSON version or district is invalid');
  if (expectedDistrict && scene.districtId !== expectedDistrict) return;
  if (!Array.isArray(scene.models) || !Array.isArray(scene.anchors) || !Array.isArray(scene.paths) || !Array.isArray(scene.colliders)) throw new Error('scene JSON collections are incomplete');
  const anchorKinds = new Set(scene.anchors.map((anchor) => anchor.kind));
  for (const kind of ['arrival', 'travel', 'mission', 'conversation', 'work', 'queue']) if (!anchorKinds.has(kind)) throw new Error(`scene JSON lacks ${kind} anchors`);
  if (scene.anchors.filter((anchor) => anchor.id.startsWith('npc-spawn-')).length < 12) throw new Error('scene JSON lacks 12 NPC spawns');
  if (scene.paths.filter((path) => path.purpose === 'queue').length < 2) throw new Error('scene JSON lacks two queue paths');
}
