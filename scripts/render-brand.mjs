/*
 * Rasterise the Beacon Crest into every size the product and the submission
 * need.
 *
 * Why a browser rather than extending scripts/make-icons.mjs: that file draws
 * the old mark with hand-written signed distance functions, which is elegant
 * for a chart line and the wrong tool for an emblem with isometric faces,
 * gradients and a radial glow. Chrome already renders SVG exactly, and the
 * SVG in brand/beacon-crest.svg stays the single source the marks come from.
 *
 *   node scripts/render-brand.mjs
 *
 * Chrome is found the same way scripts/measure-atlas.mjs finds it; set CHROME
 * to override.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const WebSocket = require('ws');

const crest = readFileSync(join(root, 'brand', 'beacon-crest.svg'), 'utf8');
const PORT = 9337;

/* target, width, height, and how the crest is placed on it. */
const TARGETS = [
  ['public/icon-192.png', 192, 192, 'square'],
  ['public/icon-512.png', 512, 512, 'square'],
  ['public/icon-180.png', 180, 180, 'square'],
  ['public/favicon-32.png', 32, 32, 'square'],
  ['brand/app-icon-1024.png', 1024, 1024, 'square'],
  ['brand/x-app-icon-512.png', 512, 512, 'square'],
  ['brand/x-app-icon-400.png', 400, 400, 'square'],
  ['brand/x-avatar-400.png', 400, 400, 'circle'],
  ['brand/wordmark-dark.png', 1200, 400, 'wordmark-dark'],
  ['brand/wordmark-light.png', 1200, 400, 'wordmark-light'],
  ['brand/og-1200x630.png', 1200, 630, 'og'],
  ['brand/x-header-1500x500.png', 1500, 500, 'header'],
];

function page(kind, width, height) {
  // The avatar is round on X, so a square crest inside a circular crop loses
  // its ring. The circle variant fills to the edge instead.
  const inset = kind === 'circle' ? 0 : Math.round(Math.min(width, height) * 0.07);
  const markSize = kind === 'square' || kind === 'circle' ? Math.min(width, height) - inset * 2 : Math.round(height * 0.56);
  const light = kind === 'wordmark-light';
  const background = light ? '#f7f9ff' : '#10142c';
  const ink = light ? '#10142c' : '#f7f9ff';
  const muted = light ? '#5b6488' : '#a6b0d6';
  const lockup = kind === 'wordmark-dark' || kind === 'wordmark-light' || kind === 'og' || kind === 'header';
  // Inlined, not linked. The page is served as a data: URL and a data:
  // document cannot reach file:// resources, so a linked face silently falls
  // back to a system sans and the wordmark renders in the wrong typeface.
  const fontData = readFileSync(join(root, 'public', 'fonts', 'luckiest-guy-latin.woff2')).toString('base64');
  return `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: AtlasDisplay; src: url(data:font/woff2;base64,${fontData}) format('woff2'); font-display: block; }
    html,body { margin:0; padding:0; width:${width}px; height:${height}px; overflow:hidden; }
    body { background:${lockup ? background : 'transparent'}; display:flex; align-items:center; justify-content:center; gap:${Math.round(height * 0.07)}px; }
    .mark { width:${markSize}px; height:${markSize}px; display:block; }
    .mark svg { width:100%; height:100%; }
    .type { font-family:AtlasDisplay, system-ui, sans-serif; color:${ink}; font-size:${Math.round(height * 0.2)}px; line-height:.94; letter-spacing:.01em; }
    .type small { display:block; font-family:ui-sans-serif,system-ui,sans-serif; font-weight:700; font-size:${Math.round(height * 0.048)}px; letter-spacing:.2em; color:${muted}; margin-top:${Math.round(height * 0.035)}px; }
  </style><div class="mark">${crest}</div>${lockup ? `<div class="type">NIM<br>ATLAS<small>RELIGHT THE CITY</small></div>` : ''}`;
}

function findChrome() {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  for (const executable of candidates) if (existsSync(executable)) return executable;
  throw new Error('Chrome not found. Set CHROME to its executable.');
}

const chrome = spawn(findChrome(), [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files',
  `--user-data-dir=${join(root, '.brand-render-profile')}`, 'about:blank',
], { stdio: 'ignore' });

async function endpoint() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      return version.webSocketDebuggerUrl;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Chrome did not expose a debugger port.');
}

try {
  const socket = new WebSocket(await endpoint(), { perMessageDeflate: false });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let nextId = 1;
  const pending = new Map();
  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw));
    const entry = pending.get(frame.id);
    if (!entry) return;
    pending.delete(frame.id);
    frame.error ? entry.reject(new Error(frame.error.message)) : entry.resolve(frame.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 20000);
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);

  for (const [target, width, height, kind] of TARGETS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    const html = page(kind, width, height);
    await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      // Transparent behind the icons; the lockups paint their own background.
      ...(kind === 'square' || kind === 'circle' ? {} : {}),
    }, sessionId);
    const out = join(root, target);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(`${target.padEnd(34)} ${width}x${height}`);
  }
  socket.close();
} finally {
  chrome.kill();
}
