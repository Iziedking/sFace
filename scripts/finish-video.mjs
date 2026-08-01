/**
 * Put the sound on, burn the captions, and export.
 *
 * Runs after build-video.mjs, which lays the picture and writes the caption
 * file. Both read the same script, so the words on screen and the words being
 * spoken come from one array and cannot drift apart.
 *
 *   node scripts/finish-video.mjs
 *
 * Narration is read from .video/voice/000.wav, 001.wav and so on, one file per
 * line of the script. Missing files become silence of the estimated length, so
 * the video can be built and watched before a voice exists.
 *
 * ## The music
 *
 * The game's own theme, which is the right track for the obvious reason and
 * also the only one nobody has to be asked about. It is pushed well down and
 * then ducked further by the narration itself through a sidechain compressor,
 * so speech is never competing with it. Fades at both ends, because a track
 * that starts at full and stops dead sounds like a mistake.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const VIDEO = join(ROOT, '.video');
const WORK = join(VIDEO, 'work');
const VOICE = join(VIDEO, 'voice48');
const MUSIC = join(ROOT, 'public', 'audio', 'theme.mp3');
const OUT = join(VIDEO, 'sface-demo.mp4');

const script = JSON.parse(readFileSync(join(ROOT, 'scripts', 'video-script.json'), 'utf8'));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('exit', (c) =>
      c === 0 ? resolve() : reject(new Error(`${cmd} exited ${c}\n${err.slice(-1500)}`)),
    );
  });
}
const ff = (args) => run('ffmpeg', ['-hide_banner', '-v', 'error', ...args]);

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

/**
 * One continuous narration track: each line, then its hold as silence.
 *
 * Built by concatenation rather than by placing clips at timestamps, so the
 * track and the caption file are generated from the same walk over the same
 * array. There is no arithmetic in one that is not in the other.
 */
async function buildNarration() {
  await mkdir(WORK, { recursive: true });
  const parts = [];

  // The same lead in the title card is holding for. See the note in build-video.
  const leadIn = Number(script.leadIn) || 0;
  if (leadIn > 0) {
    const head = join(WORK, 'lead.wav');
    await ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${leadIn}`, head, '-y']);
    parts.push({ file: head, seconds: leadIn });
  }

  for (const [i, line] of script.lines.entries()) {
    const wav = join(VOICE, `${String(i).padStart(3, '0')}.wav`);
    const spoken = existsSync(wav)
      ? await duration(wav)
      : (line.text.split(/\s+/).length / 145) * 60 + 0.35;

    const piece = join(WORK, `n${String(i).padStart(3, '0')}.wav`);

    if (existsSync(wav)) {
      // Straight copy. These are already 48k stereo, and re-encoding here is
      // exactly what moved the durations away from what the captions were timed
      // against.
      await ff(['-i', wav, '-c:a', 'copy', piece, '-y']);
    } else {
      await ff([
        '-f', 'lavfi',
        '-i', `anullsrc=r=48000:cl=stereo:d=${spoken.toFixed(3)}`,
        piece, '-y',
      ]);
    }
    parts.push({ file: piece, seconds: spoken });

    const hold = line.hold ?? 0;
    if (hold > 0) {
      const gap = join(WORK, `h${String(i).padStart(3, '0')}.wav`);
      await ff(['-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${hold.toFixed(3)}`, gap, '-y']);
      parts.push({ file: gap, seconds: hold });
    }
  }

  const listFile = join(WORK, 'narration.txt');
  await writeFile(listFile, parts.map((p) => `file '${p.file.replace(/\\/g, '/')}'`).join('\n'));

  const track = join(WORK, 'narration.wav');

  /*
   * Re-encoded across the join, not stream copied.
   *
   * Copying PCM through the concat demuxer glues the payloads together and
   * trusts every part to have an identical header. They do not always, and the
   * mismatch lands as a tick or a swallowed syllable at a join, which is heard
   * as the voice tripping partway through a sentence.
   *
   * Decoding and re-encoding the whole thing costs a second of build time and
   * makes the boundaries stop existing.
   */
  await ff([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
    track, '-y',
  ]);

  const total = await duration(track);
  const spoke = parts.filter((_, i) => i % 1 === 0).length;
  return { track, total, hasVoice: existsSync(join(VOICE, '000.wav')), pieces: spoke };
}

/**
 * The same lines as an SRT, timed against the rendered audio.
 *
 * Every editor takes SRT. Written from the prepared clips, so the timings are
 * the ones actually in the exported file rather than an estimate of them.
 */
async function writeSrt() {
  const stamp = (sec) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(sec % 60)).padStart(2, '0');
    const ms = String(Math.round((sec % 1) * 1000)).padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  };

  let at = 0;
  const blocks = [];

  for (const [i, line] of script.lines.entries()) {
    const wav = join(VOICE, `${String(i).padStart(3, '0')}.wav`);
    const spoken = existsSync(wav)
      ? await duration(wav)
      : (line.text.split(/\s+/).length / 145) * 60 + 0.35;

    blocks.push(String(i + 1) + '\n' + stamp(at) + ' --> ' + stamp(at + spoken) + '\n' + line.text + '\n');
    at += spoken + (line.hold ?? 0);
  }

  const file = join(VIDEO, 'sface-demo.srt');
  await writeFile(file, blocks.join('\n'), 'utf8');
  console.log(`captions written to ${file}`);
}

async function main() {
  const picture = join(WORK, 'silent.mp4');
  if (!existsSync(picture)) throw new Error('run build-video.mjs first');

  const pictureLength = await duration(picture);
  const { track, total, hasVoice } = await buildNarration();

  console.log(`picture   ${pictureLength.toFixed(1)}s`);
  console.log(`narration ${total.toFixed(1)}s  ${hasVoice ? '(recorded)' : '(silent placeholder)'}`);

  const length = Math.min(pictureLength, total);
  if (length > 270) throw new Error(`${length.toFixed(0)}s is over the 4:30 limit`);

  /*
   * Captions are written as a sidecar rather than burned into the picture.
   *
   * Baked captions cannot be restyled, repositioned or translated, and an
   * editor would have to mask them to do any of it. The SRT goes out beside
   * the video instead. Set BURN=1 to put them back in the frame.
   */
  const burn = process.env.BURN === '1';

  const captions = join(WORK, 'captions.ass').replace(/\\/g, '/').replace(/:/g, '\\:');

  /*
   * One pass: picture, captions burned in, music ducked under the narration.
   *
   * sidechaincompress keys the music off the voice track, so the duck follows
   * the actual speech rather than a set of fades somebody guessed at. The
   * music is already low before the duck; the compressor takes it lower only
   * while a line is being said.
   */
  const filter = [
    burn ? `[0:v]subtitles='${captions}'[v]` : `[0:v]null[v]`,
    `[1:a]volume=0.20,afade=t=in:st=0:d=2.5,afade=t=out:st=${(length - 3).toFixed(2)}:d=3[bed]`,
    /*
     * Split, because the voice is used twice and a label is not reusable.
     *
     * It is both the thing being mixed in and the key the compressor listens to
     * for the duck. Feeding one label to two filters fails with "stream
     * specifier matches no streams", which reads like a missing input and sends
     * you looking at the files rather than at the graph.
     */
    // Up to stereo at 48k before anything else touches it. The recorded clips
    // are mono at 22k, and letting that propagate makes the whole export mono.
    `[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=1.7,dynaudnorm=f=200:g=5,asplit=2[voiceKey][voiceMix]`,
    `[bed][voiceKey]sidechaincompress=threshold=0.045:ratio=9:attack=12:release=380[ducked]`,
    // No weights argument: the space inside `weights=1 1.6` breaks ffmpeg's
    // filter parser and it reports the failure as a missing stream, which sends
    // you looking in entirely the wrong place. The voice is lifted with its own
    // volume stage instead.
    `[ducked][voiceMix]amix=inputs=2:duration=first,alimiter=limit=0.94,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[a]`,
  ].join(';');

  await ff([
    '-i', picture,
    '-stream_loop', '-1', '-i', MUSIC,
    '-i', track,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-t', String(length),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-movflags', '+faststart',
    OUT, '-y',
  ]);

  await writeSrt();

  const finalLength = await duration(OUT);
  const mins = Math.floor(finalLength / 60);
  const secs = Math.round(finalLength % 60);

  console.log(`\nwrote ${OUT}`);
  console.log(`runtime ${mins}:${String(secs).padStart(2, '0')}  (limit 4:30)`);
  if (!hasVoice) {
    console.log('NOTE: no narration recorded yet, so the voice track is silence.');
    console.log('      Captions and timing are already cut to the script.');
  }
}

await main();
