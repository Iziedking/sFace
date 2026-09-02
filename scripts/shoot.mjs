/**
 * Capture the screenshots the README shows off.
 *
 * ## Why this exists rather than somebody taking them by hand
 *
 * The showcase has to be re-shot every time the art or a stage changes, and a
 * folder of hand-taken screenshots goes stale the moment anybody edits a colour.
 * This drives a real browser against the dev server and puts the game into each
 * state deliberately, so the whole set can be regenerated with one command and
 * always matches the build it sits next to.
 *
 * It also means the shots are of the REAL game rather than mockups. Every pixel
 * in the README came out of the running app.
 *
 * ## How it talks to the browser
 *
 * Chrome DevTools Protocol over a websocket, with no Playwright or Puppeteer
 * dependency. The binaries Playwright already installed on this machine are
 * reused, so the repo gains a script and no package.
 *
 * Usage:  npm run dev   (in another terminal)
 *         node scripts/shoot.mjs
 *         node scripts/shoot-atlas.mjs  (NIM Atlas Release A evidence)
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ORIGIN = process.env.SHOOT_ORIGIN ?? 'http://localhost:5173';
const OUT = join(process.cwd(), 'docs', 'shots');
/* Served, unlike docs/shots. The in-app guide reads from here. */
const GUIDE_OUT = join(process.cwd(), 'public', 'guide');
const PORT = 9333;

/** Desktop, and a phone in portrait. The mini app lives on the second one. */
const VIEWPORTS = {
  wide: { width: 1360, height: 840, scale: 1, mobile: false },
  phone: { width: 390, height: 844, scale: 2, mobile: true },
  /*
   * A phone in landscape inside the Nimiq Pay WebView.
   *
   * The height is what the wallet actually leaves after its own header, which
   * is the tightest box the app has to work in and the one worth checking a
   * layout change against.
   */
  wallet: { width: 844, height: 480, scale: 2, mobile: true },
};

async function findChrome() {
  const roots = [
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright'),
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of await readdir(root)) {
      if (!dir.startsWith('chromium-')) continue;
      const exe = join(root, dir, 'chrome-win', 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }

  // Fall back to a system install, which is what a CI runner or a mac has.
  for (const guess of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]) {
    if (existsSync(guess)) return guess;
  }

  throw new Error('No Chrome or Chromium found. Install one, or set CHROME.');
}

/** Minimal CDP client. One socket, one id counter, promises keyed by id. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const pending = this.waiting.get(msg.id);
      if (pending) {
        this.waiting.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error.message));
        else pending.resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} timed out`));
      }, 30_000);
    });
  }

  /** Run an expression in the page and return its value. */
  async eval(expression) {
    const out = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (out.exceptionDetails) {
      throw new Error(out.exceptionDetails.exception?.description ?? 'page threw');
    }
    return out.result.value;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every shot: a name, a viewport, and what to do to the page before capturing.
 *
 * The setup functions reach into the app's own dev handle rather than clicking
 * through menus. Clicking is what makes a capture script flaky; asking the app
 * to be in a state is deterministic.
 */
const SHOTS = [
  {
    name: 'opening',
    view: 'wide',
    caption: 'Every visit opens here. Tapping starts the story, and unlocks the voice.',
    skipIntro: false,
    async setup() {
      // Nothing. This shot IS the opening, so it is captured as it lands.
    },
  },
  {
    name: 'home-wallet',
    view: 'wallet',
    caption: 'Inside Nimiq Pay, landscape, with the walletâ€™s own header above.',
    async setup(cdp) {
      await cdp.eval(`window.sface.showBrief()`);
    },
  },
  {
    name: 'home',
    view: 'wide',
    caption: 'The front door: todayâ€™s coin, its move, and the ways in.',
    async setup(cdp) {
      await cdp.eval(`window.sface.showBrief()`);
    },
  },
  {
    name: 'home-phone',
    view: 'phone',
    caption: 'The same screen on a phone, which is where the mini app lives.',
    async setup(cdp) {
      await cdp.eval(`window.sface.showBrief()`);
    },
  },
  {
    name: 'chart-run',
    guide: 'chart',
    view: 'wide',
    caption: 'Stage one. The ground is todayâ€™s real 24 hour chart.',
    async setup(cdp) {
      await cdp.eval(`(() => {
        const a = window.sface;
        a.practice = true; a.stage = 1; a.prepareRun();
        a.screen = 'run';
        document.querySelector('#ui').style.display = 'none';
        return 'ok';
      })()`);
      await wait(1200);
    },
  },
  {
    name: 'city',
    guide: 'city',
    view: 'wide',
    caption: 'Stage five leaves the chart for streets built from the dayâ€™s bars.',
    async setup(cdp) {
      await cdp.eval(`(async () => {
        const a = window.sface;
        const { RunState } = await import('/src/game/state.ts');
        const run = new RunState(a.mission, 'sidearm', 5, true);
        run.player.x = run.city.startX + 400;
        run.player.y = run.city.startY - 300;
        a.run = run;
        a.screen = 'run';
        document.querySelector('#ui').style.display = 'none';
        a.renderer.resize();
        a.camera.resize(a.renderer.width, a.renderer.height);
        a.camera.jumpToFree(run.player, run.city);
        a.renderer.draw(run, a.camera, a.effects);
        a.hud.measure();
        a.hud.draw(a.renderer.context, run, a.input, a.renderer.width, a.renderer.height);
        return 'ok';
      })()`);
      await wait(500);
    },
  },
  {
    name: 'rings',
    view: 'wide',
    caption: 'Stage seven: concentric walls around a core, worked inward.',
    async setup(cdp) {
      await cdp.eval(`(async () => {
        const a = window.sface;
        const { RunState } = await import('/src/game/state.ts');
        const run = new RunState(a.mission, 'sidearm', 7, true);
        const c = run.rings;
        run.player.x = c.cx;
        run.player.y = c.cy - (c.rings[c.rings.length - 1].radius + 260);
        a.run = run;
        a.screen = 'run';
        document.querySelector('#ui').style.display = 'none';
        a.renderer.resize();
        a.camera.resize(a.renderer.width, a.renderer.height);
        const { Camera } = await import('/src/render/camera.ts');
        a.camera.zoomOut(Camera.RING_ZOOM_OUT);
        a.camera.jumpToFree(run.player, c);
        a.renderer.draw(run, a.camera, a.effects);
        a.hud.measure();
        a.hud.draw(a.renderer.context, run, a.input, a.renderer.width, a.renderer.height);
        return 'ok';
      })()`);
      await wait(500);
    },
  },
  {
    name: 'rings-wallet',
    guide: 'rings',
    view: 'wallet',
    caption: 'On a phone in Nimiq Pay. Stage seven: concentric walls around a core, worked inward.',
    async setup(cdp) {
      await cdp.eval(`(async () => {
        const a = window.sface;
        const { RunState } = await import('/src/game/state.ts');
        const run = new RunState(a.mission, 'sidearm', 7, true);
        const c = run.rings;
        run.player.x = c.cx;
        run.player.y = c.cy - (c.rings[c.rings.length - 1].radius + 260);
        a.run = run;
        a.screen = 'run';
        document.querySelector('#ui').style.display = 'none';
        a.renderer.resize();
        a.camera.resize(a.renderer.width, a.renderer.height);
        const { Camera } = await import('/src/render/camera.ts');
        a.camera.zoomOut(Camera.RING_ZOOM_OUT);
        a.camera.jumpToFree(run.player, c);
        a.renderer.draw(run, a.camera, a.effects);
        a.hud.measure();
        a.hud.draw(a.renderer.context, run, a.input, a.renderer.width, a.renderer.height);
        return 'ok';
      })()`);
      await wait(500);
    },
  },
  {
    /*
     * Stage six with a panel open, for the guide.
     *
     * Reading is the one verb no other stage has, and a sentence about four
     * posts means nothing until somebody has seen the card. Wallet viewport,
     * because that is the screen the guide is read on.
     */
    name: 'guide-panel',
    view: 'wallet',
    guide: 'panel',
    caption: 'Stage six. Four posts that genuinely went out, one explains the day.',
    async setup(cdp) {
      await cdp.eval(`(async () => {
        const a = window.sface;
        const { RunState } = await import('/src/game/state.ts');
        const run = new RunState(a.mission, 'sidearm', 6, true);
        const node = run.nodes[0];
        if (node) {
          run.player.x = node.x;
          run.player.y = node.y;
          run.openNodeId = node.id;
        }
        a.run = run;
        a.screen = 'run';
        document.querySelector('#ui').style.display = 'none';
        a.renderer.resize();
        a.camera.resize(a.renderer.width, a.renderer.height);
        a.camera.jumpToFree(run.player, run.city);
        a.renderer.draw(run, a.camera, a.effects);
        a.hud.measure();
        a.hud.draw(a.renderer.context, run, a.input, a.renderer.width, a.renderer.height);
        return 'ok';
      })()`);
      await wait(500);
    },
  },
  {
    /* The pads, in play, so the guide can point at the thing it describes. */
    name: 'guide-pads',
    view: 'wallet',
    guide: 'pads',
    scheme: 'analog',
    caption: 'The fixed pads: stick, fire, and your four buys on the arc.',
    async setup(cdp) {
      await cdp.eval(`(async () => {
        const a = window.sface;
        const { RunState } = await import('/src/game/state.ts');
        const run = new RunState(a.mission, 'sidearm', 5, true);
        run.purse.held = 400;
        a.run = run;
        a.screen = 'run';
        a.input.slotCount = 4;
        document.querySelector('#ui').style.display = 'none';
        a.renderer.resize();
        a.camera.resize(a.renderer.width, a.renderer.height);
        a.camera.jumpToFree(run.player, run.city);
        a.renderer.draw(run, a.camera, a.effects);
        a.hud.measure();
        a.hud.draw(a.renderer.context, run, a.input, a.renderer.width, a.renderer.height);
        return 'ok';
      })()`);
      await wait(500);
    },
  },
  {
    name: 'ending',
    view: 'wide',
    caption: 'Clearing the campaign: the day you flew, against everything before it.',
    async setup(cdp) {
      await cdp.eval(`(async () => {
        const a = window.sface;
        const e = await import('/src/ui/ending.ts');
        const { RunState } = await import('/src/game/state.ts');
        const mission = { ...a.mission, market: a.mission.market ?? {
          totalUsd: 2.29e12, changePct: 0.18, btcDominance: 56.6, assets: 18070,
        } };
        const run = new RunState(mission, 'sidearm', 7);
        run.phase = 'extracted';
        document.querySelector('#ui').style.display = '';
        e.renderEnding(document.querySelector('#ui'), { state: run, onContinue: () => {} });
        return 'ok';
      })()`);
      await wait(2600);
    },
  },
  {
    name: 'docs',
    view: 'wide',
    caption: 'In-app documentation, reachable from the footer on every screen.',
    async setup(cdp) {
      await cdp.eval(`(() => {
        document.querySelector('#ui').style.display = '';
        window.sface.showAbout();
        return 'ok';
      })()`);
      await wait(400);
    },
  },
  {
    name: 'how-to-play',
    view: 'phone',
    caption: 'The guide, written for a thumb first.',
    async setup(cdp) {
      await cdp.eval(`(() => {
        document.querySelector('#ui').style.display = '';
        window.sface.showControls();
        return 'ok';
      })()`);
      await wait(400);
    },
  },
  {
    name: 'controls',
    view: 'phone',
    caption: 'Three control schemes, all live at once. This only picks the listener.',
    async setup(cdp) {
      // The boot paints the front door once the profile answers, so asking for
      // a screen before that finishes gets it painted over.
      await wait(1400);
      await cdp.eval(`(() => {
        document.querySelector('#ui').style.display = '';
        window.sface.showSettings();
        return 'ok';
      })()`);
      await wait(400);
    },
  },
  {
    name: 'testnet',
    view: 'phone',
    /*
     * The faucet card only exists on testnet, so this shot asks to boot there.
     * Declared rather than switched in setup: switching reloads, which would
     * restart the opening and land the capture on the intro.
     */
    network: 'test',
    caption: 'On testnet, the faucet claim lives in the app rather than behind a link.',
    async setup(cdp) {
      await wait(1400);
      await cdp.eval(`(() => {
        document.querySelector('#ui').style.display = '';
        window.sface.showSettings();
        return 'ok';
      })()`);
      // Long enough for the live /info call to land, so the card shows real
      // numbers rather than "Checking the faucet...".
      await wait(2600);
      // The network block is the last thing on a long page, so a phone-shaped
      // capture of the top would miss the whole point of this shot.
      await cdp.eval(`(() => {
        document.querySelector('.settings__net')?.scrollIntoView({ block: 'end' });
        return 'ok';
      })()`);
      await wait(500);
    },
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });

  const exe = await findChrome();
  console.log(`chrome: ${exe}`);

  const chrome = spawn(
    exe,
    [
      `--remote-debugging-port=${PORT}`,
      '--headless=new',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--user-data-dir=' + join(process.cwd(), '.shoot-profile'),
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // Wait for the debugging endpoint rather than guessing at a delay.
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await wait(250);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      target = list.find((t) => t.type === 'page') ?? null;
    } catch {
      // Not up yet.
    }
  }
  if (!target) throw new Error('Chrome never opened its debugging port.');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const captions = [];

  for (const shot of SHOTS) {
    const view = VIEWPORTS[shot.view];
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: view.width,
      height: view.height,
      deviceScaleFactor: view.scale,
      mobile: view.mobile,
    });

    /*
     * The network, decided before the page loads rather than switched after.
     *
     * Switching in-app reloads on purpose, so doing it inside a shot's setup
     * restarts the whole boot including the opening, and the capture lands on
     * the intro instead of the screen it asked for. Seeding sessionStorage
     * ahead of navigation is the only way to have the app come up already on
     * the network the shot needs.
     *
     * Removed again after the shot, or it would leak into every later one.
     */
    const seeded = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: [
        `sessionStorage.setItem('sface.network', ${JSON.stringify(shot.network ?? 'main')});`,
        /*
         * And the opening, marked seen unless this shot IS the opening.
         *
         * Clicking Skip after load works only while nothing else restarts the
         * boot. Declaring a network does restart it, and the capture then lands
         * on the intro. Marking it seen before the first script runs removes the
         * timing question entirely rather than tuning a wait against it.
         */
        shot.skipIntro === false ? '' : `sessionStorage.setItem('sface.intro', 'done');`,
        // A shot that needs the pads on screen says so, rather than depending
        // on whatever the previous one left in storage.
        shot.scheme ? `localStorage.setItem('sface.controls', ${'JSON.stringify(shot.scheme)'});` : `localStorage.removeItem('sface.controls');`,
      ].join(''),
    });

    await cdp.send('Page.navigate', { url: ORIGIN });
    /*
     * Wait for the app to finish booting rather than for the load event.
     *
     * The mission is fetched after load and every shot depends on it being
     * there, so polling for the dev handle is the only honest signal.
     */
    for (let i = 0; i < 60; i++) {
      await wait(250);
      const ready = await cdp.eval(`Boolean(window.sface && window.sface.mission)`).catch(() => false);
      if (ready) break;
    }
    /*
     * Past the opening, which now plays on every visit and waits for a tap.
     *
     * Deliberately skipped rather than watched: these captures are of the game,
     * and sitting through five beats before each one would make the script take
     * minutes. The opening has its own shot below.
     */
    if (shot.skipIntro !== false) {
      await cdp.eval(`(() => {
        const skip = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Skip',
        );
        if (skip) skip.click();
        return 'ok';
      })()`).catch(() => undefined);
      await wait(2400);
    } else {
      await wait(600);
    }

    try {
      await shot.setup(cdp);
    } catch (error) {
      console.log(`  ${shot.name}: setup failed, skipping (${error.message})`);
      continue;
    }

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${shot.name}.png`);
    await writeFile(file, Buffer.from(data, 'base64'));

    captions.push({ name: shot.name, caption: shot.caption, view: shot.view });
    // Or the next shot inherits this one's network.
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: seeded.identifier,
    });

    /*
     * A copy for the in-app guide.
     *
     * docs/shots is for the README and is not served. The guide is read inside
     * the running app, so anything it points at has to be in public/. Written
     * from the same capture rather than shot twice, so the two can never drift.
     */
    if (shot.guide) {
      await mkdir(GUIDE_OUT, { recursive: true });
      await writeFile(join(GUIDE_OUT, `${shot.guide}.png`), Buffer.from(data, 'base64'));
    }

    console.log(`  captured ${shot.name}.png (${view.width}x${view.height})`);
  }

  await writeFile(join(OUT, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);

  await packGuide();

  ws.close();
  chrome.kill();
  console.log(`\n${captions.length} shots written to docs/shots`);
}

if (process.env.SFACE_ATLAS_SHOTS === '1') {
  await import('./shoot-atlas.mjs');
} else {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

/**
 * Turn the guide copies into something worth shipping.
 *
 * These go into the bundle and are downloaded by anybody who opens How to Play,
 * so they are not allowed to be full-size PNGs. WebP at 760 wide takes the set
 * from about 200KB to 60KB with the text still legible, which matters because
 * the whole point is that somebody can read the panel in the screenshot.
 *
 * Done here rather than by hand, or the next run of this script quietly leaves
 * PNGs beside the .webp paths the guide is asking for and every image in it
 * breaks at once.
 */
async function packGuide() {
  const { existsSync } = await import('node:fs');
  if (!existsSync(GUIDE_OUT)) return;

  const files = (await readdir(GUIDE_OUT)).filter((f) => f.endsWith('.png'));
  if (files.length === 0) return;

  for (const file of files) {
    const from = join(GUIDE_OUT, file);
    const to = join(GUIDE_OUT, `${file.slice(0, -4)}.webp`);

    await new Promise((resolve, reject) => {
      const ff = spawn(
        'ffmpeg',
        ['-v', 'error', '-i', from, '-vf', "scale='min(760,iw)':-1:flags=lanczos", '-q:v', '86', to, '-y'],
        { stdio: 'inherit' },
      );
      ff.on('error', reject);
      ff.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });

    await rm(from);
  }

  console.log(`guide: ${files.length} images packed to public/guide`);
}
