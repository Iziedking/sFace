import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Isolated, loopback-only character review. No API, wallet, env file, or saved
// game is loaded. Serve only this fixture, native character assets and modules.
export async function startCharacterLab(port = 5191) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      let relative;
      if (pathname === '/') relative = 'scripts/fixtures/atlas-character-lab.html';
      else if (pathname.startsWith('/vendor/three/')) relative = `node_modules/three/${pathname.slice('/vendor/three/'.length)}`;
      else if (/^\/src\/atlas\/render\/three\/character-[a-z-]+(?:\.ts)?$/.test(pathname)) relative = pathname.slice(1) + (pathname.endsWith('.ts') ? '' : '.ts');
      else if (pathname === '/shared/atlas/city/character-gait') relative = 'shared/atlas/city/character-gait.ts';
      else if (/^\/public\/atlas\/3d\/v1\/characters\/atlas-walker-(player|npc-lod1|npc-lod2)\.glb$/.test(pathname)) relative = pathname.slice(1);
      else { response.writeHead(404); response.end(); return; }
      const target = resolve(root, relative);
      if (!target.startsWith(root + sep) || relative.split('/').includes('..')) { response.writeHead(403); response.end(); return; }
      const bytes = await readFile(target);
      const isTs = target.endsWith('.ts');
      response.setHeader('Content-Type', isTs || target.endsWith('.js') ? 'text/javascript' : target.endsWith('.html') ? 'text/html' : 'model/gltf-binary');
      response.setHeader('Cache-Control', 'no-store');
      response.end(isTs ? ts.transpileModule(bytes.toString(), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText : bytes);
    } catch {
      response.writeHead(500); response.end('Character review resource unavailable.');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

if (typeof process !== 'undefined' && process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await startCharacterLab();
  console.log('Character review: http://127.0.0.1:5191');
}
