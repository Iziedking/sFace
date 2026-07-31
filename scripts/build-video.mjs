/**
 * Cut the launch video.
 *
 * Everything is derived from one place: scripts/video-script.json. The narration
 * audio, the caption timings and the length of each shot all come out of that
 * array, so a caption cannot drift from what is being said and a rewrite reflows
 * the whole edit rather than needing the timeline nudged by hand.
 *
 *   node scripts/build-video.mjs
 *
 * Inputs it looks for, in order of preference per scene:
 *   .video/hand/<scene>.mp4   footage recorded by a person playing
 *   .video/frames/<scene>/    frames captured headless
 *
 * Hand footage wins because a person playing knows where the action is, which
 * is the one thing the headless capture cannot work out for itself.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const VIDEO = join(ROOT, '.video');
const WORK = join(VIDEO, 'work');
const FPS = 30;
const W = 1920;
const H = 1080;

/** Brand. Same ink and accent the game uses. */
const INK = '0x17150F';
const CANVAS = '0xF4EDE0';
const ACCENT = '0xF9541F';

const script = JSON.parse(readFileSync(join(ROOT, 'scripts', 'video-script.json'), 'utf8'));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}\n${err.slice(-1200)}`)),
    );
  });
}

const ff = (args) => run('ffmpeg', ['-hide_banner', '-v', 'error', ...args]);

/** Duration of a media file, in seconds. */
async function duration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      file,
    ]);
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.on('error', reject);
    p.on('exit', () => resolve(parseFloat(out.trim()) || 0));
  });
}

/**
 * How long each line of narration takes.
 *
 * Read from the rendered audio when there is any, and estimated from the word
 * count when there is not, so the edit can be built and watched before a voice
 * exists. The estimate is deliberately the same shape as the real thing: a
 * rewrite changes the timeline either way.
 */
async function lineTimings() {
  const timings = [];
  let at = 0;

  for (const [i, line] of script.lines.entries()) {
    // The prepared clip, not the recorded one. See scripts/prep-voice.mjs:
    // measuring a different file from the one that gets mixed is what put the
    // captions five seconds ahead of the voice.
    const voice = join(VIDEO, 'voice48', `${String(i).padStart(3, '0')}.wav`);
    const spoken = existsSync(voice)
      ? await duration(voice)
      : // 145 words a minute, plus a beat for the full stop.
        (line.text.split(/\s+/).length / 145) * 60 + 0.35;

    const hold = line.hold ?? 0;
    timings.push({ ...line, index: i, start: at, spoken, total: spoken + hold });
    at += spoken + hold;
  }

  return { timings, total: at };
}

/** Seconds of footage each scene has to cover, summed over its lines. */
function sceneLengths(timings) {
  const need = new Map();
  for (const t of timings) need.set(t.scene, (need.get(t.scene) ?? 0) + t.total);
  return need;
}

/**
 * Build one shot of the required length from whatever source exists.
 *
 * A source shorter than the slot is slowed slightly rather than looped, because
 * a loop is visible and a five per cent slow down is not. Longer is trimmed from
 * the start, where the action is: the captures drift as they go.
 */
/*
 * A cursor into the one long recording a person made.
 *
 * They played straight through rather than recording a clip per scene, which is
 * the sensible way to do it, so gameplay shots are taken in order from that
 * single file. Each one starts where the last finished, so the video moves
 * through their run the same way they played it and nothing is reused.
 */
let handCursor = 0;

/*
 * Screens that must show the screen they are about.
 *
 * The narration over these talks about the front door, a clan table and the
 * ending, so playing gameplay under them would be showing one thing while
 * saying another. The headless capture is perfect for a static screen and
 * useless for a run, which is exactly the opposite of a person playing, so each
 * scene takes whichever source is actually good at it.
 */
const PREFER_CAPTURE = new Set(['home', 'clan', 'guide']);

async function buildShot(scene, seconds) {
  const out = join(WORK, `${scene}.mp4`);
  const hand = join(VIDEO, 'hand', `${scene}.mp4`);
  const reel = join(VIDEO, 'hand', 'reel.mp4');
  const frames = join(VIDEO, 'frames', scene);

  if (existsSync(reel) && !(PREFER_CAPTURE.has(scene) && existsSync(frames))) {
    const have = await duration(reel);
    // Wrap rather than run dry, and start a little in so the first shot is not
    // somebody still finding the keyboard.
    if (handCursor + seconds > have) handCursor = 2;
    const from = handCursor;
    handCursor += seconds;

    await ff([
      '-ss', from.toFixed(2),
      '-i', reel,
      '-t', String(seconds),
      '-vf',
      /*
       * The browser goes first.
       *
       * Fullscreen was dragging the game so this was recorded windowed, which
       * leaves a title bar and an address bar across the top forty five pixels
       * of every frame. Cropping before the upscale means those pixels are
       * never enlarged into the output, and the game fills the frame the way it
       * would have if fullscreen had behaved.
       */
      `crop=iw:ih-45:0:45,scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},fps=${FPS},format=yuv420p`,
      '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      out, '-y',
    ]);
    return out;
  }

  if (existsSync(hand)) {
    const have = await duration(hand);
    const rate = have >= seconds ? 1 : Math.max(0.75, have / seconds);
    await ff([
      '-i', hand,
      '-t', String(seconds / (rate === 1 ? 1 : 1)),
      '-vf',
      `setpts=${(1 / rate).toFixed(4)}*PTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},format=yuv420p`,
      '-an', '-t', String(seconds),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      out, '-y',
    ]);
    return out;
  }

  if (!existsSync(frames)) return null;

  const files = (await readdir(frames)).filter((f) => f.endsWith('.png'));
  if (files.length === 0) return null;

  /*
   * Short captures are held, not slowed.
   *
   * These are menus. Slowing one down does nothing visible except cap how long
   * it can run: the clan capture is 8.6s and a 0.6 rate floor made 14.4s, which
   * silently came up five seconds short of its slot and left the whole video
   * that much out of step with the narration.
   *
   * Cloning the last frame fills the rest exactly. On a static screen it is
   * indistinguishable from the screen simply being on, which is what it is.
   */
  await ff([
    '-framerate', String(FPS),
    '-i', join(frames, '%05d.png'),
    '-vf',
    `scale=${W}:${H}:flags=lanczos,fps=${FPS},tpad=stop_mode=clone:stop_duration=${seconds.toFixed(3)},format=yuv420p`,
    '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    out, '-y',
  ]);
  return out;
}

/** A plain brand card, for the open and the close. */
async function buildCard(name, seconds, big, small) {
  const out = join(WORK, `${name}.mp4`);
  const font = 'C\\:/Windows/Fonts/arialbd.ttf';

  await ff([
    '-f', 'lavfi',
    '-i', `color=c=${CANVAS}:s=${W}x${H}:d=${seconds}:r=${FPS}`,
    '-vf',
    [
      `drawtext=fontfile='${font}':text='${big}':fontcolor=${INK}:fontsize=128:x=(w-tw)/2:y=(h/2)-110`,
      `drawtext=fontfile='${font}':text='${small}':fontcolor=${ACCENT}:fontsize=44:x=(w-tw)/2:y=(h/2)+40`,
      // A slow push in, so a still card still has life in it.
      `zoompan=z='min(zoom+0.0006,1.06)':d=1:s=${W}x${H}:fps=${FPS}`,
      'format=yuv420p',
    ].join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    out, '-y',
  ]);
  return out;
}

/** Captions, as ASS, styled to sit clear of the HUD at the top of the frame. */
function buildCaptions(timings) {
  const t = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2).padStart(5, '0');
    return `${h}:${String(m).padStart(2, '0')}:${sec}`;
  };

  /* Wrapped by hand at roughly forty characters, because libass breaks lines
     where it likes and a caption that splits a phrase reads badly. */
  const wrap = (text) => {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > 42) {
        lines.push(line.trim());
        line = w;
      } else {
        line += ' ' + w;
      }
    }
    if (line.trim()) lines.push(line.trim());
    return lines.slice(0, 3).join('\\N');
  };

  const head = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    // Bottom centre, heavy outline plus a soft box, so it survives a bright
    // chart and a dark HUD without a background plate.
    'Style: Main,Arial,52,&H00FFFFFF,&H00000000,&H90000000,1,3,3,2,2,120,120,72,1',
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];

  const events = timings.map(
    (line) =>
      `Dialogue: 0,${t(line.start)},${t(line.start + line.spoken + Math.min(line.hold ?? 0, 0.5))},Main,,0,0,0,,${wrap(line.text)}`,
  );

  return [...head, ...events].join('\n');
}

async function main() {
  await mkdir(WORK, { recursive: true });

  const { timings, total } = await lineTimings();
  console.log(`script: ${script.lines.length} lines, ${total.toFixed(1)}s of narration + holds`);
  if (total > 270) console.log('WARNING: over 4:30, trim the script');

  const need = sceneLengths(timings);
  console.log('\nshots:');

  const order = [];
  for (const [scene, seconds] of need) {
    if (scene === 'title') {
      order.push({ scene, file: await buildCard('title', seconds, 'sFace', 'THE MARKET BUILDS THE LEVEL'), seconds });
      continue;
    }
    if (scene === 'close') {
      order.push({ scene, file: await buildCard('close', seconds, 'sface.site', 'GITHUB.COM/IZIEDKING/SFACE'), seconds });
      continue;
    }
    if (scene === 'problem') {
      order.push({ scene, file: await buildCard('problem', seconds, 'A BAD YEAR', 'PROJECTS DOWN. HOPES SHAKEN.'), seconds });
      continue;
    }

    const file = await buildShot(scene, seconds);
    if (!file) {
      console.log(`  ${scene.padEnd(8)} MISSING, skipped`);
      continue;
    }
    order.push({ scene, file, seconds });
    const source =
      existsSync(join(VIDEO, 'hand', 'reel.mp4')) && !PREFER_CAPTURE.has(scene)
        ? 'played'
        : 'screen capture';
    console.log(`  ${scene.padEnd(8)} ${seconds.toFixed(1)}s  (${source})`);
  }

  await writeFile(join(WORK, 'captions.ass'), buildCaptions(timings), 'utf8');
  await writeFile(
    join(WORK, 'order.json'),
    JSON.stringify({ total, order: order.map((o) => ({ scene: o.scene, seconds: o.seconds })) }, null, 2),
  );

  // Straight cuts for now; the crossfade pass runs over this list.
  const list = order.map((o) => `file '${o.file.replace(/\\/g, '/')}'`).join('\n');
  await writeFile(join(WORK, 'concat.txt'), list, 'utf8');

  await ff([
    '-f', 'concat', '-safe', '0', '-i', join(WORK, 'concat.txt'),
    '-c', 'copy', join(WORK, 'silent.mp4'), '-y',
  ]);

  const built = await duration(join(WORK, 'silent.mp4'));
  console.log(`\npicture: ${built.toFixed(1)}s at ${W}x${H}${FPS}`);
  console.log('next: narration into .video/voice, then the audio pass');
}

await main();
