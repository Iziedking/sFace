const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const adminRoot = document.querySelector<HTMLElement>('#admin');
if (!adminRoot) throw new Error('Admin root is missing.');
const root = adminRoot;

let token = '';
let idleTimer: number | null = null;

function login(message = 'Enter the admin token. It is kept in memory until this tab locks.'): void {
  token = '';
  if (idleTimer !== null) window.clearTimeout(idleTimer);
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
  const response = await adminFetch('/admin/api/overview', token);
  if (!response.ok) {
    login('The session ended. Enter the admin token again.');
    return;
  }
  const data = await response.json() as {
    uptimeSeconds: number;
    commit: string | null;
    date: string;
    persistence: { status: string; lastError: string | null };
    capabilities: Record<string, { enabled: boolean; required: boolean }>;
    config: Array<{ key: string; configured: boolean; secret: boolean; restartRequired: boolean }>;
  };
  root.innerHTML = `
    <header><div><p class="eyebrow">SFACEE control plane</p><h1>Live diagnostics</h1></div><button id="lock">Lock</button></header>
    <section class="summary">
      <article><span>Persistence</span><strong>${data.persistence.status}</strong><small>${data.persistence.lastError ?? 'No active error'}</small></article>
      <article><span>Uptime</span><strong>${Math.floor(data.uptimeSeconds / 60)} min</strong><small>${data.commit ?? 'Commit not reported'}</small></article>
      <article><span>UTC mission day</span><strong>${data.date}</strong><small>Public health contract</small></article>
    </section>
    <section><h2>Capabilities</h2><div class="ledger">${Object.entries(data.capabilities).map(([name, state]) => `
      <article><span>${name}</span><strong class="${state.enabled ? 'on' : 'off'}">${state.enabled ? 'enabled' : 'disabled'}</strong><small>${state.required ? 'required' : 'optional'}</small></article>`).join('')}</div></section>
    <section><h2>Configuration</h2><div class="ledger">${data.config.map((entry) => `
      <article><span>${entry.key}</span><strong class="${entry.configured ? 'on' : 'off'}">${entry.configured ? 'configured' : 'missing'}</strong><small>${entry.secret ? 'secret, value hidden' : 'non-secret'}${entry.restartRequired ? ', restart required' : ', runtime metadata'}</small></article>`).join('')}</div></section>`;
  root.querySelector<HTMLButtonElement>('#lock')?.addEventListener('click', () => login());
  for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, resetIdleLock, { once: true });
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
