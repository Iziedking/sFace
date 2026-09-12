/*
 * Build the v2 Atlas walker and register it, without disturbing v1.
 *
 * The v1 character is still what the districts load: `scene.json` and
 * `shared/atlas/city/pay-harbor.ts` both point at /atlas/3d/v1/. v2 is staged
 * under its own ids and its own path so `npm run verify:atlas:3d` holds it to
 * its budgets while v1 keeps shipping. Switching over is then a scene repoint
 * once v2 has been seen on a real device, not a rebuild.
 *
 *   node scripts/build-atlas-character-v2.mjs [--skip-blender]
 *
 * Blender is required unless --skip-blender is passed, in which case the GLBs
 * already sitting in the art directory are staged as they are.
 */
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, relative } from 'node:path';

const root = process.cwd();
const skipBlender = process.argv.includes('--skip-blender');

const characterSource = join(root, 'art', 'atlas', 'characters', 'atlas-walker-v2');
const buildScript = join(characterSource, 'build_character.py');
const sourceFile = 'art/atlas/characters/atlas-walker-v2/build_character.py';
const publicRoot = join(root, 'public', 'atlas', '3d', 'v2');
const manifestPath = join(root, 'public', 'atlas', 'manifests', 'assets-v2.json');

// Built name -> staged name and the budget the verifier holds it to. The
// budgets live in scripts/verify-atlas-3d.mjs; they are repeated here only so
// this script fails loudly at build time rather than at gate time.
const ASSETS = [
  ['atlas-walker-v2.glb', 'atlas-walker-v2-player.glb', 'atlas-walker-v2-player', 12000],
  ['atlas-walker-v2-lod1.glb', 'atlas-walker-v2-lod1.glb', 'atlas-walker-v2-lod1', 3300],
  ['atlas-walker-v2-lod2.glb', 'atlas-walker-v2-lod2.glb', 'atlas-walker-v2-lod2', 800],
  // The second body. Only the crowd LODs: the player is a single known figure,
  // so a variant there would change who the player is rather than add variety.
  ['atlas-walker-v2-female-lod1.glb', 'atlas-walker-v2-female-lod1.glb', 'atlas-walker-v2-female-lod1', 3300],
  ['atlas-walker-v2-female-lod2.glb', 'atlas-walker-v2-female-lod2.glb', 'atlas-walker-v2-female-lod2', 800],
];

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function resolveBlender() {
  const candidates = [
    process.env.BLENDER,
    'blender',
    'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
    'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe',
    '/Applications/Blender.app/Contents/MacOS/Blender',
    '/usr/bin/blender',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const ok = await new Promise((resolve) => {
      execFile(candidate, ['--version'], (error) => resolve(!error));
    });
    if (ok) return candidate;
  }
  throw new Error('Blender is required to build the v2 character. Set BLENDER to its executable, or pass --skip-blender to stage the GLBs already in the art directory.');
}

async function runBlender(extraArgs = []) {
  const blender = await resolveBlender();
  await new Promise((resolve, reject) => {
    execFile(
      blender,
      ['--background', '--python', buildScript, '--', '--out', characterSource, ...extraArgs],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`Blender failed: ${stderr || error.message}`));
        const line = stdout.split('\n').find((candidate) => candidate.startsWith('ATLAS_V2_METRICS'));
        if (!line) return reject(new Error('Blender produced no ATLAS_V2_METRICS line; the build did not finish.'));
        console.log(line);
        resolve();
      },
    );
  });
}

function triangleCount(bytes) {
  if (bytes.subarray(0, 4).toString('ascii') !== 'glTF') throw new Error('not a GLB');
  const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
  let triangles = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      triangles += primitive.indices === undefined
        ? document.accessors[primitive.attributes.POSITION].count / 3
        : document.accessors[primitive.indices].count / 3;
    }
  }
  return { triangles, animations: document.animations?.length ?? 0, joints: document.skins?.[0]?.joints.length ?? 0 };
}

async function stage() {
  const staged = [];
  for (const [built, target, id, budget] of ASSETS) {
    const from = join(characterSource, built);
    await access(from).catch(() => {
      throw new Error(`Missing ${built}. Run without --skip-blender to build it.`);
    });
    const to = join(publicRoot, 'characters', target);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);

    const bytes = await readFile(to);
    const { triangles, animations, joints } = triangleCount(bytes);
    if (triangles > budget) throw new Error(`${id} is over budget: ${triangles} > ${budget}`);
    if (animations !== 4) throw new Error(`${id} carries ${animations} clips, not 4`);
    if (joints !== 23) throw new Error(`${id} carries ${joints} joints, not 23`);
    staged.push({ id, to, triangles });
    console.log(`staged ${id}: ${triangles} triangles, ${animations} clips, ${joints} joints, ${bytes.length} bytes`);
  }
  return staged;
}

async function updateManifest(staged) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entries = [];
  for (const { id, to } of staged) {
    const bytes = await readFile(to);
    const relativePath = `/${relative(join(root, 'public'), to).split(String.fromCharCode(92)).join('/')}`;
    entries.push({
      id,
      path: relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      compressedBytes: bytes.length,
      mime: 'model/gltf-binary',
      width: 1,
      height: 1,
      bundle: 'atlas-character-v2',
      quality: ['low', 'balanced', 'high'],
      sourceFile,
      sourceSha256: await sha256(join(root, sourceFile)),
      sourceStatus: 'owner-approved-procedural',
    });
  }
  const ownedIds = new Set(entries.map((entry) => entry.id));
  manifest.assets = [...manifest.assets.filter((asset) => !ownedIds.has(asset.id)), ...entries];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`manifest updated: ${entries.length} v2 entries, ${manifest.assets.length} assets total`);
}

if (!skipBlender) {
  await runBlender();
  await runBlender(['--variant', 'female']);
}
await updateManifest(await stage());
