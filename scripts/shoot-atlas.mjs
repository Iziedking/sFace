import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const origin = process.env.SHOOT_ORIGIN ?? 'http://127.0.0.1:4173';
const out = join(process.cwd(), 'docs', 'shots');
const publicOut = join(process.cwd(), 'public', 'atlas', 'screenshots');
const profile = process.env.ATLAS_SHOOT_PROFILE ?? join(process.cwd(), '.atlas-shoot-profile');
const port = 9334;
const viewports = [
  { name: '320', width: 320, height: 700 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
];

async function main() {
const chrome = spawn(await findChrome(), [
  `--remote-debugging-port=${port}`,
  '--headless=new',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  await mkdir(out, { recursive: true });
  await mkdir(publicOut, { recursive: true });
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await open(ws);
  const cdp = new Cdp(ws);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true });
    // ?capture=1 asks main.ts for the capture hook; see openLanternForCapture.
    await cdp.send('Page.navigate', { url: `${origin}?capture=1` });
    await waitForApp(cdp);
    await capture(cdp, `${viewport.name}-welcome`);
    await clickText(cdp, 'How to play');
    await capture(cdp, `${viewport.name}-how-to-play`);
    await clickText(cdp, 'Atlas home');
    /*
     * The lantern screen is several gameplay steps deep: the welcome screen's
     * one primary action opens Beacon Commons, and Mara is reached by walking
     * there. This used to click a button that went straight to her, which
     * stopped existing when the screen was given a single primary action, so
     * the capture asks for the screen instead of trying to play the game.
     */
    await openLantern(cdp);
    await capture(cdp, `${viewport.name}-pay-harbor`);
    await clickText(cdp, 'Enter Pay Harbor shop');
    await clickText(cdp, 'Inspect the harbor lantern');
    await clickText(cdp, 'Review payment request');
    await capture(cdp, `${viewport.name}-payment-review`);
    console.log(`captured Atlas ${viewport.width}x${viewport.height}`);
  }

  ws.close();
} finally {
  chrome.kill();
}
}

async function openLantern(cdp) {
  const opened = await cdp.eval('(() => { const app = window.atlasCapture; if (!app) return false; app.openLanternForCapture(); return true; })()');
  if (!opened) throw new Error('Atlas capture hook missing: load the page with ?capture=1.');
  await wait(200);
}

async function capture(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const image = Buffer.from(data, 'base64');
  await writeFile(join(out, `atlas-${name}.png`), image);
  await writeFile(join(publicOut, `atlas-${name}.png`), image);
}

/*
 * Poll for the button rather than assuming it is already there.
 *
 * Returning to the welcome screen resets cityLoadState to 'loading' and
 * re-streams the district, and while that is in flight the screen renders its
 * loading splash, which has no run button on it. A flat 80 ms wait was a race
 * that the capture lost as soon as the district got big enough, and because
 * shoot:atlas is not part of `npm run check`, nothing reported it.
 */
async function clickText(cdp, text, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const clicked = await cdp.eval(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); if (!button) return false; button.click(); return true; })()`);
    if (clicked) break;
    if (Date.now() > deadline) throw new Error(`Atlas capture could not find button after ${timeoutMs} ms: ${text}`);
    await wait(150);
  }
  await wait(120);
}

async function waitForApp(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await cdp.eval(`Boolean(document.querySelector('button'))`).catch(() => false)) return;
    await wait(100);
  }
  throw new Error(`Atlas app did not load at ${origin}`);
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === 'page');
      if (target) return target;
    } catch { /* Chrome is still starting. */ }
    await wait(100);
  }
  throw new Error('Atlas capture Chrome did not open its debugging port.');
}

async function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const root = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (existsSync(root)) {
    for (const directory of readdirSync(root)) {
      const executable = join(root, directory, 'chrome-win', 'chrome.exe');
      if (directory.startsWith('chromium-') && existsSync(executable)) return executable;
    }
  }
  for (const executable of ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) if (existsSync(executable)) return executable;
  throw new Error('No Chrome or Chromium found. Install one, or set CHROME.');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.waiting.get(message.id);
      if (!pending) return;
      this.waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      const timeout = setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(`${method} timed out`)); }, 30_000);
      timeout.unref?.();
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Atlas page evaluation failed');
    return result.result.value;
  }
}

function open(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
