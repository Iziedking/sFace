/**
 * Find where each captured scene stops being gameplay.
 *
 * The headless captures drift: a run ends, or the app falls back to the loading
 * screen, and the rest of the scene is menu chrome over a dead level. Watching
 * every frame by eye is not practical and missing one puts a broken shot in the
 * middle of the video.
 *
 * The tell is the top strip. During a run the HUD paints it near black across
 * the full width. Every other screen has the cream page header there. So the
 * first frame whose top strip is light is the first frame that is no longer a
 * run, and everything from there is dropped.
 *
 *   node scripts/trim.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const FRAMES = join(process.cwd(), '.video', 'frames');
const FPS = 30;

/** Average luma of a strip across the top of one frame, via ffmpeg. */
function topStripLuma(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-v', 'error',
      '-i', file,
      // A wide band across the top, away from the corners so a logo or a chip
      // cannot swing the average on its own.
      '-vf', 'crop=1200:30:360:8,scale=1:1',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ]);

    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('error', reject);
    ff.on('exit', () => {
      const b = Buffer.concat(chunks);
      if (b.length < 3) return reject(new Error('no pixel'));
      resolve((b[0] * 0.299 + b[1] * 0.587 + b[2] * 0.114) / 255);
    });
  });
}

/** Dark strip means the run HUD is up. Cream means we have left the game. */
const IN_RUN = 0.35;

const scenes = (await readdir(FRAMES, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const report = {};

for (const scene of scenes) {
  const dir = join(FRAMES, scene);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.png')).sort();

  // Every tenth frame is enough to find the boundary to a third of a second,
  // and a hundred times cheaper than every frame.
  let lastGood = -1;
  let firstBad = -1;

  for (let i = 0; i < files.length; i += 10) {
    const luma = await topStripLuma(join(dir, files[i]));
    const inRun = luma < IN_RUN;
    if (inRun) {
      lastGood = i;
    } else if (lastGood >= 0 || i === 0) {
      firstBad = i;
      break;
    }
  }

  // A menu scene is light the whole way through and that is correct for it.
  const isRunScene = lastGood >= 0;
  const usable = isRunScene ? (firstBad === -1 ? files.length : firstBad) : files.length;

  report[scene] = {
    frames: files.length,
    kind: isRunScene ? 'run' : 'screen',
    usable,
    seconds: +(usable / FPS).toFixed(1),
    lost: files.length - usable,
  };

  console.log(
    `${scene.padEnd(8)} ${report[scene].kind.padEnd(6)} ${String(files.length).padStart(4)} frames  ` +
      `usable ${String(usable).padStart(4)} (${report[scene].seconds}s)` +
      (report[scene].lost ? `  dropped ${report[scene].lost}` : ''),
  );
}

const total = Object.values(report).reduce((n, r) => n + r.usable, 0);
console.log(`\ntotal usable: ${(total / FPS).toFixed(1)}s across ${scenes.length} scenes`);

await readFile(join(process.cwd(), 'package.json')); // keeps the import honest
