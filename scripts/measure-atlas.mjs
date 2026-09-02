import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';

const execFileAsync = promisify(execFile);
const root = dirname(fileURLToPath(new URL('.', import.meta.url)));
// Usage: node scripts/measure-atlas.mjs --url http://127.0.0.1:4173 --viewports 320x700,390x844,430x932 --minutes 30
const args = parseArgs(process.argv.slice(2));
const viewports = parseViewports(args.viewports ?? '320x700,390x844,430x932');
const url = args.url ?? 'http://127.0.0.1:4173';

const manifest = JSON.parse(await readFile(join(root, 'public/atlas/manifests/assets-v1.json'), 'utf8'));
const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8');
const manifestCompressedBytes = gzipSync(JSON.stringify(manifest)).byteLength;
const shell = await measureShell();
const districtBundles = measureDistrictBundles(manifest);
const traceBytes = measureTraceBytes(1_350);
const replay = await measureReplay();
const firstUse = await measureFirstUse(url, viewports);
const browser = await measureBrowser(url, viewports, Number(args.minutes ?? 30));

const result = {
  url,
  buildMetadata: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    manifestVersion: manifest.version,
  },
  observationWindowMinutes: Number(args.minutes ?? 30),
  viewports,
  manifestBytes,
  manifestCompressedBytes,
  mobileAssetBytes: manifest.assets.reduce((total, asset) => total + asset.compressedBytes, 0),
  mobileAssetBudgetBytes: manifest.mobileBudgetBytes,
  shell,
  districtBundles,
  traceBytes,
  p95ReplayMs: replay.p95ReplayMs,
  replayHeapDeltaBytes: replay.heapDeltaBytes,
  firstUse,
  inputLatencyMs: browser.inputLatencyMs,
  p50FrameMs: browser.p50FrameMs,
  p95FrameMs: browser.p95FrameMs,
  memoryWindow: browser.memoryWindow,
  browserByViewport: browser.byViewport,
  notes: [
    'firstUseMs is the measured HTML response time for each requested viewport; it is not a DOM-ready or deployed-device claim.',
    'replayHeapDeltaBytes is a bounded-process sample, not a proof of leak absence.',
    'memoryWindow is complete only when observedMinutes meets the requested window; heap samples come from the browser DevTools runtime.',
  ],
};

console.log(JSON.stringify(result, null, 2));

if (result.mobileAssetBytes > result.mobileAssetBudgetBytes) fail(`Atlas manifest exceeds its mobile asset budget: ${result.mobileAssetBytes} > ${result.mobileAssetBudgetBytes}.`);
if (result.shell.gzipBytes > 150 * 1024) fail(`Atlas shell exceeds its 150 KiB gzip budget: ${result.shell.gzipBytes}.`);
if (result.traceBytes > 64 * 1024) fail(`Atlas normal trace exceeds its 64 KiB budget: ${result.traceBytes}.`);
if (result.p95ReplayMs >= 100) fail(`Atlas replay p95 exceeds 100 ms: ${result.p95ReplayMs}.`);
if (result.p95FrameMs >= 34) fail(`Atlas browser frame p95 exceeds 34 ms: ${result.p95FrameMs}.`);

/*
 * The shell is what index.html loads eagerly: its module entry, its stylesheet,
 * and anything modulepreloaded beside them.
 *
 * This used to sum every .js and .css in dist/assets, which counted the
 * dynamically imported scene-graph chunk — three.js, about 259 KB gzipped — as
 * if it were shell. vite.config.ts says the opposite in as many words: three.js
 * sits behind `await import('../render/scene-graph')` so a phone that never
 * opens the city never downloads it. The budget had therefore been failing
 * since the 3D city landed, and because measure:atlas is not part of
 * `npm run check`, nothing reported it.
 */
async function measureShell() {
  const directory = join(root, 'dist/assets');
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((match) => match[1]);
  const shellFiles = [...new Set(referenced)].filter((file) => /\.(?:js|css)$/.test(file) && existsSync(join(directory, file)));
  if (shellFiles.length === 0) throw new Error('Atlas shell measurement found no eagerly loaded assets in dist/index.html.');
  const sizes = await Promise.all(shellFiles.map(async (file) => {
    const contents = await readFile(join(directory, file));
    return { file, bytes: contents.byteLength, gzipBytes: gzipSync(contents).byteLength };
  }));
  const deferred = (await readdir(directory)).filter((file) => /\.(?:js|css)$/.test(file) && !shellFiles.includes(file));
  return {
    files: sizes,
    deferredFileCount: deferred.length,
    rawBytes: sizes.reduce((total, item) => total + item.bytes, 0),
    gzipBytes: sizes.reduce((total, item) => total + item.gzipBytes, 0),
  };
}

function measureDistrictBundles(value) {
  const bundles = new Map();
  for (const asset of value.assets) {
    const current = bundles.get(asset.bundle) ?? { rawBytes: 0, compressedBytes: 0, assetCount: 0 };
    current.rawBytes += asset.bytes;
    current.compressedBytes += asset.compressedBytes;
    current.assetCount += 1;
    bundles.set(asset.bundle, current);
  }
  return Object.fromEntries([...bundles.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function measureTraceBytes(length) {
  const trace = Array.from({ length }, (_, tick) => [tick % 3 === 0 ? 127 : 0, tick % 5 === 0 ? -127 : 0, 0, 0, 0]);
  return Buffer.byteLength(JSON.stringify(trace), 'utf8');
}

async function measureReplay() {
  const code = `
    const { replayAtlasActions } = await import('./shared/atlas/replay.ts');
    const { GENESIS_GARDEN_MISSION } = await import('./shared/atlas/districts/genesis-garden.ts');
    const actions = Array.from({ length: 1350 }, (_, tick) => ({ moveX: tick % 3 === 0 ? 127 : 0, moveY: tick % 5 === 0 ? -127 : 0, tool: 'none', interact: false, system: 'active' }));
    const samples = [];
    const before = process.memoryUsage().heapUsed;
    for (let repeat = 0; repeat < 101; repeat++) {
      const start = performance.now();
      replayAtlasActions(GENESIS_GARDEN_MISSION, actions);
      if (repeat > 0) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ p95ReplayMs: Number(samples[Math.floor(samples.length * 0.95)]?.toFixed(3) ?? 0), heapDeltaBytes: process.memoryUsage().heapUsed - before }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', '--eval', code], { cwd: root, maxBuffer: 1024 * 1024 });
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (!line) fail('Replay measurement returned no result.');
  return JSON.parse(line);
}

async function measureFirstUse(target, requestedViewports) {
  const entries = [];
  for (const viewport of requestedViewports) {
    const start = performance.now();
    let response;
    try {
      response = await fetch(target, { headers: { 'x-atlas-viewport': `${viewport.width}x${viewport.height}` }, signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      fail(`Atlas URL is unavailable for ${viewport.width}x${viewport.height}: ${error instanceof Error ? error.message : 'request failed'}.`);
    }
    const body = await response.arrayBuffer();
    entries.push({ viewport: `${viewport.width}x${viewport.height}`, status: response.status, ok: response.ok, responseBytes: body.byteLength, firstUseMs: Number((performance.now() - start).toFixed(3)) });
  }
  return entries;
}

async function measureBrowser(target, requestedViewports, requestedMinutes) {
  if (!Number.isFinite(requestedMinutes) || requestedMinutes < 0 || requestedMinutes > 60) fail('The memory observation window must be between 0 and 60 minutes.');
  const chrome = spawn(await findChrome(), [
    '--remote-debugging-port=9335', '--headless=new', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(root, '.atlas-measure-profile')}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const targetInfo = await waitForTarget();
    const ws = new WebSocket(targetInfo.webSocketDebuggerUrl);
    await open(ws);
    const cdp = new Cdp(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const byViewport = [];
    for (const viewport of requestedViewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: target });
      await waitForApp(cdp);
      byViewport.push({ viewport: `${viewport.width}x${viewport.height}`, ...(await measureInteractiveFrame(cdp)) });
    }
    const memoryViewport = requestedViewports.find((viewport) => viewport.width === 390) ?? requestedViewports[0];
    if (memoryViewport) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: memoryViewport.width, height: memoryViewport.height, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Page.navigate', { url: target });
      await waitForApp(cdp);
    }
    const memoryWindow = await measureMemoryWindow(cdp, requestedMinutes, memoryViewport);
    ws.close();
    const frameSamples = byViewport.flatMap((entry) => entry.frameSamplesMs);
    frameSamples.sort((left, right) => left - right);
    return {
      inputLatencyMs: percentile(byViewport.map((entry) => entry.inputLatencyMs), 0.95),
      p50FrameMs: percentile(frameSamples, 0.50),
      p95FrameMs: percentile(frameSamples, 0.95),
      memoryWindow,
      byViewport: byViewport.map(({ frameSamplesMs: _samples, ...entry }) => entry),
    };
  } finally {
    chrome.kill();
  }
}

async function measureInteractiveFrame(cdp) {
  const metrics = await cdp.eval(`(async () => {
    const action = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Meet Mara');
    const started = performance.now();
    if (action) action.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const inputLatencyMs = performance.now() - started;
    const frameSamplesMs = [];
    let previous = performance.now();
    await new Promise((resolve) => {
      const sample = (now) => {
        frameSamplesMs.push(now - previous);
        previous = now;
        if (frameSamplesMs.length >= 121) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return { inputLatencyMs: Number(inputLatencyMs.toFixed(3)), frameSamplesMs };
  })()`);
  return { inputLatencyMs: Number(metrics.inputLatencyMs ?? 0), frameSamplesMs: metrics.frameSamplesMs ?? [] };
}

async function measureMemoryWindow(cdp, requestedMinutes, viewport) {
  const requestedMs = requestedMinutes * 60_000;
  const started = performance.now();
  const samples = [];
  while (performance.now() - started < requestedMs) {
    const heap = await cdp.send('Runtime.getHeapUsage');
    samples.push({ elapsedMs: Math.round(performance.now() - started), usedSizeBytes: heap.usedSize, totalSizeBytes: heap.totalSize });
    const remaining = requestedMs - (performance.now() - started);
    if (remaining <= 0) break;
    await wait(Math.min(5_000, remaining));
  }
  const observedMinutes = (performance.now() - started) / 60_000;
  const usedSizes = samples.map((sample) => sample.usedSizeBytes);
  return {
    viewport: viewport ? `${viewport.width}x${viewport.height}` : null,
    requestedMinutes,
    observedMinutes: Number(observedMinutes.toFixed(3)),
    complete: observedMinutes + 0.01 >= requestedMinutes,
    samples: samples.length,
    firstUsedSizeBytes: usedSizes[0] ?? null,
    lastUsedSizeBytes: usedSizes.at(-1) ?? null,
    peakUsedSizeBytes: usedSizes.length > 0 ? Math.max(...usedSizes) : null,
    deltaUsedSizeBytes: usedSizes.length > 1 ? usedSizes.at(-1) - usedSizes[0] : 0,
  };
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9335/json/list');
      const targets = await response.json();
      const target = targets.find((item) => item.type === 'page');
      if (target) return target;
    } catch { /* Chrome is still starting. */ }
    await wait(100);
  }
  throw new Error('Atlas measurement Chrome did not open its debugging port.');
}

async function waitForApp(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await cdp.eval('Boolean(document.querySelector("button"))').catch(() => false)) return;
    await wait(100);
  }
  throw new Error(`Atlas app did not load at ${url}.`);
}

async function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const browserRoot = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (existsSync(browserRoot)) {
    for (const directory of readdirSync(browserRoot)) {
      const executable = join(browserRoot, directory, 'chrome-win', 'chrome.exe');
      if (directory.startsWith('chromium-') && existsSync(executable)) return executable;
    }
  }
  for (const executable of ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']) if (existsSync(executable)) return executable;
  throw new Error('No Chrome or Chromium found. Install one, or set CHROME.');
}

function Cdp(ws) {
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
  this.send = (method, params = {}) => {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      const timeout = setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(`${method} timed out`)); }, 30_000);
      timeout.unref?.();
    });
  };
  this.eval = async (expression) => {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Atlas page evaluation failed');
    return result.result.value;
  };
}

Cdp.prototype.send = function send(method, params = {}) {
  const id = ++this.id;
  return new Promise((resolve, reject) => {
    this.waiting.set(id, { resolve, reject });
    this.ws.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => { if (this.waiting.delete(id)) reject(new Error(`${method} timed out`)); }, 30_000);
    timeout.unref?.();
  });
};

Cdp.prototype.eval = async function evaluate(expression) {
  const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Atlas page evaluation failed');
  return result.result.value;
};

function open(ws) {
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  return Number(values[Math.min(values.length - 1, Math.floor(values.length * ratio))].toFixed(3));
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function parseArgs(values) {
  const output = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const [key, inline] = value.slice(2).split('=', 2);
    output[key] = inline ?? values[++index];
  }
  return output;
}

function parseViewports(value) {
  return value.split(',').map((item) => {
    const [width, height] = item.split('x').map(Number);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) fail(`Invalid viewport: ${item}.`);
    return { width, height };
  });
}

function fail(message) {
  console.error(`Atlas measurement failed: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}
