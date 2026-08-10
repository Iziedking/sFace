const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const adminRoot = document.querySelector<HTMLElement>('#admin');
if (!adminRoot) throw new Error('Admin root is missing.');
const root = adminRoot;

let token = '';
let idleTimer: number | null = null;
let streamController: AbortController | null = null;
let pollTimer: number | null = null;

function login(message = 'Enter the admin token. It is kept in memory until this tab locks.'): void {
  token = '';
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  streamController?.abort();
  streamController = null;
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
  root.innerHTML = `
    <section class="login">
      <p class="eyebrow">SFACEE control plane</p>
      <h1>Admin access</h1>
      <p>${message}</p>
      <form id="login-form">
        <label>Admin token<input name="token" type="password" autocomplete="off" required /></label>
        <button>Open diagnostics</button>
      </form>
      <p id="error" role="alert"></p>
    </section>`;
  root.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', submitLogin);
}

async function submitLogin(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const candidate = String(form.get('token') ?? '');
  const response = await adminFetch('/admin/api/login/check', candidate, { method: 'POST' });
  if (!response.ok) {
    const error = root.querySelector<HTMLElement>('#error');
    if (error) error.textContent = 'Access denied.';
    return;
  }
  token = candidate;
  resetIdleLock();
  await overview();
}

async function overview(): Promise<void> {
  const [overviewResponse, logsResponse] = await Promise.all([
    adminFetch('/admin/api/overview', token),
    adminFetch('/admin/api/logs', token),
  ]);
  if (!overviewResponse.ok) {
    login('The session ended. Enter the admin token again.');
    return;
  }
  const data = await overviewResponse.json() as {
    uptimeSeconds: number;
    commit: string | null;
    date: string;
    persistence: { status: string; lastError: string | null };
    capabilities: Record<string, { enabled: boolean; required: boolean }>;
    config: Array<{ key: string; configured: boolean; secret: boolean; restartRequired: boolean }>;
  };
  const logs = logsResponse.ok
    ? await logsResponse.json() as { entries: Array<{ time: number; level: string; event: string; message: string }> }
    : { entries: [] };
  root.innerHTML = `
    <header><div><p class="eyebrow">SFACEE control plane</p><h1>Live diagnostics</h1></div><button id="lock">Lock</button></header>
    <section class="summary">
      <article><span>Persistence</span><strong>${data.persistence.status}</strong><small>${data.persistence.lastError ?? 'No active error'}</small></article>
      <article><span>Uptime</span><strong>${Math.floor(data.uptimeSeconds / 60)} min</strong><small>${data.commit ?? 'Commit not reported'}</small></article>
      <article><span>UTC mission day</span><strong>${data.date}</strong><small>Public health contract</small></article>
    </section>
    <section><h2>Capabilities</h2><div class="ledger">${Object.entries(data.capabilities).map(([name, state]) => `
      <article><span>${name}</span><strong class="${state.enabled ? 'on' : 'off'}">${state.enabled ? 'enabled' : 'disabled'}</strong><small>${state.required ? 'required' : 'optional'}</small></article>`).join('')}</div></section>
    <section><h2>Recent logs</h2><div class="ledger" id="live-logs">${logs.entries.slice(0, 20).map((entry) => `
      <article><span>${new Date(entry.time).toISOString()} | ${entry.level}</span><strong>${entry.event}</strong><small>${entry.message}</small></article>`).join('')}</div></section>
    <section><h2>Configuration</h2><div class="ledger">${data.config.map((entry) => `
      <article><span>${entry.key}</span><strong class="${entry.configured ? 'on' : 'off'}">${entry.configured ? 'configured' : 'missing'}</strong><small>${entry.secret ? 'secret, value hidden' : 'non-secret'}${entry.restartRequired ? ', restart required' : ', runtime metadata'}</small></article>`).join('')}</div></section>`;
  root.querySelector<HTMLButtonElement>('#lock')?.addEventListener('click', () => login());
  for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, resetIdleLock, { once: true });
  if (!streamController) void startLogStream();
}

async function startLogStream(): Promise<void> {
  streamController = new AbortController();
  try {
    const response = await adminFetch('/admin/api/logs/stream', token, { signal: streamController.signal });
    if (!response.ok || !response.body) throw new Error('stream unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (token) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error('stream ended');
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const data = event.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
        if (!data) continue;
        const entry = JSON.parse(data) as { time: number; level: string; event: string; message: string };
        prependLog(entry);
      }
    }
  } catch {
    if (!token) return;
    streamController = null;
    if (pollTimer === null) pollTimer = window.setInterval(() => void overview(), 30_000);
  }
}

function prependLog(entry: { time: number; level: string; event: string; message: string }): void {
  const ledger = root.querySelector<HTMLElement>('#live-logs');
  if (!ledger) return;
  const article = document.createElement('article');
  const meta = document.createElement('span');
  const eventName = document.createElement('strong');
  const message = document.createElement('small');
  meta.textContent = `${new Date(entry.time).toISOString()} | ${entry.level}`;
  eventName.textContent = entry.event;
  message.textContent = entry.message;
  article.append(meta, eventName, message);
  ledger.prepend(article);
  while (ledger.children.length > 20) ledger.lastElementChild?.remove();
}

function resetIdleLock(): void {
  if (!token) return;
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => login('Locked after 15 minutes without activity.'), 15 * 60_000);
}

function adminFetch(path: string, bearer: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, authorization: `Bearer ${bearer}` },
  });
}

login();
