/**
 * Normalise the narration clips once, so everything downstream measures the
 * same files.
 *
 * ## The drift this exists to stop
 *
 * The caption timings were taken from the recorded clips and the narration
 * track was built from re-encoded copies of them. Re-encoding to 48k stereo
 * moves a clip's duration by a fraction of a second, which is invisible on any
 * one line and is not invisible by line twenty two: the picture came out at
 * 193.9s while the narration ran 198.7s, so the words on screen finished five
 * seconds before the voice did.
 *
 * Nothing is wrong with either measurement. They were measuring different
 * files. So the conversion happens here, once, and both the caption builder and
 * the audio mixer read the converted clips and nothing else.
 *
 *   node scripts/prep-voice.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const IN = join(ROOT, '.video', 'voice');
const OUT = join(ROOT, '.video', 'voice48');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-800)))));
  });
}

async function duration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      file,
    ]);
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.on('exit', () => resolve(parseFloat(out.trim()) || 0));
  });
}

if (!existsSync(IN)) {
  console.log('no .video/voice, nothing to prepare');
  process.exit(0);
}

await mkdir(OUT, { recursive: true });

const files = (await readdir(IN)).filter((f) => f.endsWith('.wav')).sort();
let total = 0;

for (const file of files) {
  const from = join(IN, file);
  const to = join(OUT, file);

  await run('ffmpeg', [
    '-hide_banner', '-v', 'error',
    '-i', from,
    '-ar', '48000',
    '-ac', '2',
    '-c:a', 'pcm_s16le',
    /*
     * A short fade at each end.
     *
     * The synthesiser starts and stops abruptly, and butting twenty two of
     * those against each other gives a click on every join. Ten milliseconds is
     * below the threshold of being heard as a fade and above the threshold of
     * being heard as a click.
     */
    '-af', 'afade=t=in:st=0:d=0.01,areverse,afade=t=in:st=0:d=0.01,areverse',
    to, '-y',
  ]);

  total += await duration(to);
}

console.log(`prepared ${files.length} clips, ${total.toFixed(2)}s of speech`);
console.log('build-video and finish-video both read .video/voice48 now');
