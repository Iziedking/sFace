/*
 * Contrast verification for the Atlas player surfaces.
 *
 * Why this exists as a browser check rather than a stylesheet check.
 *
 * atlas-design-tokens.test.ts and atlas-contrast.test.ts both read source text.
 * They can prove the palette declares what it should and that a token pair
 * clears the AA floor, and neither can see what a browser actually painted:
 * colour arrives by inheritance, surfaces stack translucently over one another
 * and over a live 3D canvas, and a rule that overrides a background without
 * saying which ink goes with it produces text nobody can read while every
 * source assertion still passes.
 *
 * That is not hypothetical. Inverting the palette from ink-on-cream to
 * light-on-glass left eight surfaces unreadable, two of them at 1.01 and 1.04 —
 * the minimap and joystick labels on the play screen, invisible — and the
 * source-level guards were green throughout. This walks every reachable screen
 * and asks the page what colour it drew.
 *
 * Not part of `npm run check`, which is node-only. Run it the way shoot:atlas
 * and measure-atlas are run: build, serve the preview, then this.
 *
 * Usage:
 *   npm run build
 *   npm run preview -- --host 127.0.0.1 --port 4173
 *   npm run verify:atlas:contrast
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value.startsWith('--')) args.set(value, process.argv[index + 1] ?? true);
}

const origin = typeof args.get('--url') === 'string' ? args.get('--url') : 'http://127.0.0.1:4173';
const viewport = typeof args.get('--viewport') === 'string' ? args.get('--viewport') : '390x844';
const [width, height] = viewport.split('x').map(Number);
const profile = process.env.ATLAS_CONTRAST_PROFILE ?? join(process.cwd(), '.atlas-contrast-profile');
const port = 9336;

/*
 * Every screen a player can reach by tapping, plus the lantern.
 *
 * The lantern is several gameplay steps into the city, so it is opened through
 * the same ?capture=1 hook the screenshot pipeline uses rather than by walking
 * a character across a district.
 */
const SCREENS = [
  { name: 'welcome', click: null },
  { name: 'how-to-play', click: 'How to play' },
  { name: 'daily-puzzle', click: "Play today's Atlas puzzle" },
  { name: 'knowledge-book', click: 'Open Living Knowledge Book' },
  { name: 'district-atlas', click: 'Walk the District Atlas' },
  { name: 'beacon-commons', click: 'Start 60-second run' },
  { name: 'lantern', hook: true },
];

/*
 * Runs inside the page.
 *
 * Translucent surfaces are composited down the ancestor chain and the chain is
 * bottomed out on the city's sky, which is the brightest thing that can ever sit
 * behind a panel and therefore the worst case for dark glass. WCAG's large-text
 * allowance is honoured, because holding 18px bold to the 4.5 floor would report
 * failures that are not failures.
 */
const AUDIT = `(() => {
  const SKY = [76, 201, 240];
  const parse = (value) => {
    const match = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!match) return null;
    const parts = match[1].split(/[,\\/]/).map((part) => parseFloat(part));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const over = (top, bottom) => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3]));
  const luminance = (colour) => {
    const linear = colour.slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backdrop = (element) => {
    const stack = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const colour = parse(getComputedStyle(node).backgroundColor);
      if (colour && colour[3] > 0) stack.push(colour);
    }
    let base = SKY.concat([1]);
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base).concat([1]);
    return base;
  };
  const failures = [];
  for (const element of document.querySelectorAll('body *')) {
    const text = [...element.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (text.length < 2) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.1) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) continue;
    const foreground = parse(style.color);
    if (!foreground) continue;
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    const behind = backdrop(element);
    const measured = ratio(over(foreground, behind).concat([1]), behind);
    if (measured < floor) {
      failures.push({
        ratio: Number(measured.toFixed(2)),
        floor,
        fontPx: Math.round(size),
        selector: element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().split(/\\s+/).join('.') : ''),
        text: text.slice(0, 48),
      });
    }
  }
  return JSON.stringify(failures);
})()`;

async function main() {
  await assertOriginReachable();

  /*
   * A profile left behind by a previous run holds a lock that lets Chrome start
   * but never finish navigating, which surfaces as an unexplained
   * "Page.navigate timed out" on the second invocation. Cheaper to discard it
   * than to debug it at the call site.
   */
  rmSync(profile, { recursive: true, force: true });

  const chrome = spawn(await findChrome(), [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const report = {};
  let failureCount = 0;
  try {
    const target = await waitForTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await open(ws);
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });

    for (const screen of SCREENS) {
      // Each screen starts from a fresh load, so one screen's state cannot make
      // the next one pass.
      await cdp.send('Page.navigate', { url: `${origin}?capture=1` });
      await waitForWelcome(cdp, screen.name);
      if (screen.hook) {
        const opened = await cdp.eval('(() => { const app = window.atlasCapture; if (!app) return false; app.openLanternForCapture(); return true; })()');
        if (!opened) throw new Error(`Atlas contrast check could not open ${screen.name}: the ?capture=1 hook is missing.`);
      } else if (screen.click) {
        const clicked = await cdp.eval(`(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(screen.click)}); if (!button) return false; button.click(); return true; })()`);
        if (!clicked) throw new Error(`Atlas contrast check could not reach ${screen.name}: no button labelled "${screen.click}".`);
      }
      await wait(700);
      const failures = JSON.parse(await cdp.eval(AUDIT) ?? '[]');
      report[screen.name] = failures;
      failureCount += failures.length;
    }
    ws.close();
  } finally {
    chrome.kill();
  }

  for (const [screen, failures] of Object.entries(report)) {
    if (failures.length === 0) {
      console.log(`  ok    ${screen}`);
      continue;
    }
    console.log(`  FAIL  ${screen} (${failures.length})`);
    for (const item of failures) {
      console.log(`          ${String(item.ratio).padStart(5)} < ${item.floor}  ${item.fontPx}px  ${item.selector}`);
      console.log(`                  ${JSON.stringify(item.text)}`);
    }
  }

  if (failureCount > 0) {
    console.error(`\nAtlas contrast check failed: ${failureCount} text elements below the WCAG AA floor at ${viewport}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAtlas contrast check passed for ${SCREENS.length} screens at ${viewport}.`);
}

async function assertOriginReachable() {
  try {
    const response = await fetch(origin, { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(`Atlas contrast check needs a preview server at ${origin}. Run \`npm run build\` then \`npm run preview -- --host 127.0.0.1 --port 4173\`. (${error instanceof Error ? error.message : 'unreachable'})`);
  }
}

async function waitForWelcome(cdp, screenName) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(250);
    const ready = await cdp
      .eval(`[...document.querySelectorAll('button')].some((item) => item.textContent.includes('60-second'))`)
      .catch(() => false);
    if (ready) return;
  }
  throw new Error(`Atlas contrast check timed out waiting for the welcome screen before ${screenName}.`);
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
  throw new Error('Atlas contrast check Chrome did not open its debugging port.');
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

await main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
