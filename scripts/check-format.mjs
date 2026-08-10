import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const roots = ['.github', 'deploy', 'scripts', 'server', 'src', 'tests'];
const rootFiles = [
  '.dockerignore', '.env.example', '.gitattributes', '.gitignore',
  'Dockerfile', 'README.md', 'docker-compose.yml', 'index.html', 'package.json',
  'tsconfig.json', 'tsconfig.server.json', 'tsconfig.test.json', 'vercel.json', 'vite.config.ts',
];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.sh', '.ts', '.tsx', '.yml', '.yaml']);

function filesUnder(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => filesUnder(join(path, name)));
}

const files = [...rootFiles, ...roots.flatMap(filesUnder)]
  .filter((file) => textExtensions.has(extname(file)) || rootFiles.includes(file));
const failures = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (text.includes('\0')) continue;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/[\t ]+$/.test(line)) failures.push(`${file}:${index + 1}: trailing whitespace`);
    if (/^(<{7}|={7}|>{7})/.test(line)) failures.push(`${file}:${index + 1}: merge marker`);
  });
  if (text.length > 0 && !text.endsWith('\n')) failures.push(`${file}: missing final newline`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Formatting hygiene passed for ${files.length} files.`);
