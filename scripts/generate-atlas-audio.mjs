import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const outputDirectory = join(process.cwd(), 'public', 'atlas', 'audio');
mkdirSync(outputDirectory, { recursive: true });

const cues = [
  ['harbor-waiting-ambience', 'aevalsrc=0.045*sin(2*PI*164*t)+0.025*sin(2*PI*196*t):d=1.2'],
  ['harbor-restored-ambience', 'aevalsrc=0.045*sin(2*PI*(220+220*t)*t)+0.025*sin(2*PI*440*t):d=1.8'],
  ['beacon-confirmation', 'aevalsrc=0.055*sin(2*PI*660*t)+0.035*sin(2*PI*990*t):d=0.8'],
];

for (const [name, source] of cues) {
  const output = join(outputDirectory, `${name}.ogg`);
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source, '-c:a', 'libvorbis', '-q:a', '2', '-y', output], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Could not generate ${name}.ogg.`);
}

console.log(`Generated ${cues.length} deterministic Atlas audio cues in ${outputDirectory}.`);
