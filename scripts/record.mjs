/**
 * Record real gameplay to frames, for the launch video.
 *
 * Not a screen recorder pointed at a window. This drives the game through
 * scripted scenes and captures each frame with Chrome's screenshot API,
 * stepping the simulation by hand between frames.
 *
 * Stepping rather than racing a wall clock is what makes it usable: exact
 * thirty frames a second, no drops, no jitter, and the same footage every time
 * it is built, which is what lets narration be cut against it. Chrome's
 * screencast was the obvious tool and caps the surface well under 1080p in
 * headless, which is not recoverable afterwards.
 *
 *   node scripts/record.mjs             every scene
 *   node scripts/record.mjs hook rings  only those
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = 9400;
const ORIGIN = 'http://localhost:5173/';
const OUT = join(process.cwd(), '.video', 'frames');
const FPS = 30;
const STAGE = { width: 1920, height: 1080, scale: 1 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const g of [
    'C:/Users/bless/AppData/Local/ms-playwright/chromium-1179/chrome-win/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ]) {
    if (existsSync(g)) return g;
  }
  throw new Error('no chrome');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method) return;
      const s = this.pending.get(m.id);
      if (!s) return;
      this.pending.delete(m.id);
      m.error ? s.reject(new Error(m.error.message)) : s.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }
}

/** Start a real run at a stage and point the camera at it. */
async function play(cdp, stage) {
  await cdp.eval(
    '(async () => {' +
      'const a = window.sface;' +
      "const m = await import('/src/game/state.ts');" +
      'const r = new m.RunState(a.mission, "sidearm", ' +
      stage +
      ', true);' +
      'a.run = r; a.screen = "run"; a.paused = false;' +
      'document.querySelector("#ui").style.display = "none";' +
      'a.renderer.resize();' +
      'a.camera.resize(a.renderer.width, a.renderer.height);' +
      'if (r.rings) a.camera.jumpToFree(r.player, r.rings);' +
      'else if (r.city) a.camera.jumpToFree(r.player, r.city);' +
      'return "ok";' +
      '})()',
  );
  await wait(500);
}

/** Open a DOM screen by calling the app's own handler. */
async function screen(cdp, call) {
  await cdp.eval(
    '(() => { document.querySelector("#ui").style.display = ""; window.sface.' +
      call +
      '; return "ok"; })()',
  );
  await wait(900);
}

/** Stand at a story panel with its card open. */
async function atPanel(cdp, index) {
  await cdp.eval(
    '(() => {' +
      'const r = window.sface.run;' +
      'const n = r.nodes[' +
      index +
      '] || r.nodes[0];' +
      'if (n) { r.player.x = n.x; r.player.y = n.y; r.openNodeId = n.id; }' +
      'return "ok";' +
      '})()',
  );
}

/*
 * A flight path, not a held stick.
 *
 * The first cut held one direction for the whole scene, which flew the player
 * off the chart and into empty sky: by six seconds in the shot was bare ground
 * with nothing happening on it. A run reads as a run when the ship is working
 * the terrain, so these weave along it instead, using the frame number as the
 * clock. `f` is the frame, `t` is seconds into the scene.
 */
const FLY_RIGHT =
  '{ moveX: 0.85, moveY: Math.sin(t * 1.6) * 0.75 - 0.1, aimX: 1, aimY: Math.sin(t * 1.6) * 0.4, firing: true }';
const FLY_BACK =
  '{ moveX: -0.5 + Math.sin(t * 0.9) * 0.4, moveY: Math.cos(t * 1.3) * 0.7, aimX: -1, aimY: 0, firing: true }';
const STILL = '{ moveX: 0, moveY: 0, aimX: 1, aimY: 0, firing: false }';

const SCENES = [
  { name: 'hook', seconds: 9, drive: FLY_RIGHT, setup: (c) => play(c, 1) },
  { name: 'hook2', seconds: 8, drive: FLY_BACK, setup: (c) => play(c, 1) },
  { name: 'home', seconds: 9, setup: (c) => screen(c, 'showBrief()') },
  { name: 'chart', seconds: 13, drive: FLY_RIGHT, setup: (c) => play(c, 3) },
  { name: 'city', seconds: 13, drive: FLY_RIGHT, setup: (c) => play(c, 5) },
  {
    name: 'panel',
    seconds: 13,
    drive: STILL,
    setup: async (c) => {
      await play(c, 6);
      await atPanel(c, 0);
    },
  },
  {
    name: 'panel2',
    seconds: 8,
    drive: STILL,
    setup: async (c) => {
      await play(c, 6);
      await atPanel(c, 1);
    },
  },
  { name: 'rings', seconds: 13, drive: FLY_RIGHT, setup: (c) => play(c, 7) },
  { name: 'rings2', seconds: 9, drive: FLY_BACK, setup: (c) => play(c, 7) },
  { name: 'guide', seconds: 7, scrollPerFrame: 2, setup: (c) => screen(c, 'showControls()') },
  { name: 'clan', seconds: 9, setup: (c) => screen(c, 'openClan()') },
  { name: 'clan2', seconds: 8, setup: (c) => screen(c, 'showBoard()') },
  { name: 'ending', seconds: 13, setup: (c) => screen(c, 'showEnding()') },
];

async function main() {
  const only = process.argv.slice(2);
  const scenes = only.length ? SCENES.filter((s) => only.includes(s.name)) : SCENES;

  await mkdir(OUT, { recursive: true });

  const chrome = spawn(
    findChrome(),
    [
      '--remote-debugging-port=' + PORT,
      '--headless=new',
      '--hide-scrollbars',
      '--no-first-run',
      '--mute-audio',
      '--user-data-dir=' + join(process.cwd(), '.video', 'profile'),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page') ?? null;
    } catch {}
  }
  if (!target) throw new Error('no debugging port');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: STAGE.width,
    height: STAGE.height,
    deviceScaleFactor: STAGE.scale,
    mobile: false,
  });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'sessionStorage.setItem("sface.intro","done");localStorage.setItem("sface.controls","touch");',
  });

  for (const scene of scenes) {
    await cdp.send('Page.navigate', { url: ORIGIN });
    for (let i = 0; i < 80; i++) {
      await wait(250);
      const s = await cdp.eval('window.sface ? window.sface.screen : null').catch(() => null);
      if (s && s !== 'loading' && s !== 'intro') break;
    }
    await wait(600);

    try {
      await scene.setup(cdp);
    } catch (error) {
      // A scene that will not set up is skipped rather than taking the whole
      // recording down with it. Twelve scenes beats none.
      console.log(scene.name + ': SKIPPED (' + String(error).slice(0, 70) + ')');
      continue;
    }

    const dir = join(OUT, scene.name);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });

    const total = scene.seconds * FPS;
    for (let n = 0; n < total; n++) {
      if (scene.drive) {
        await cdp
          .eval(
            '(() => { const f = ' +
              n +
              '; const t = f / ' +
              FPS +
              '; window.sface.debug().advance(1/' +
              FPS +
              ', ' +
              scene.drive +
              '); return 1; })()',
          )
          .catch(() => {});
      }
      if (scene.scrollPerFrame) {
        await cdp
          .eval(
            '(() => { (document.querySelector(".screen")||document.querySelector("#ui"))?.scrollBy(0, ' +
              scene.scrollPerFrame +
              '); return 1; })()',
          )
          .catch(() => {});
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(dir, String(n).padStart(5, '0') + '.png'), Buffer.from(shot.data, 'base64'));
    }

    console.log(scene.name + ': ' + total + ' frames');
  }

  ws.close();
  chrome.kill();
}

await main();
process.exit(0);
