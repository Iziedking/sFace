const base = (process.env.TARGET_URL ?? '').replace(/\/$/, '');
const adminToken = process.env.ADMIN_TOKEN ?? '';
if (!base) {
  console.error('Set TARGET_URL to the deployed API origin.');
  process.exit(2);
}

const checks = [];
async function check(name, run) {
  try { const detail = await run(); checks.push({ name, ok: true, detail }); }
  catch (error) { checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
}
function requireValue(condition, message) { if (!condition) throw new Error(message); }

await check('health contract', async () => {
  const response = await fetch(`${base}/health`, { cache: 'no-store' });
  const body = await response.json();
  requireValue([200, 503].includes(response.status), `unexpected status ${response.status}`);
  requireValue(typeof body.persistence?.status === 'string', 'persistence status missing');
  requireValue(body.capabilities && typeof body.capabilities === 'object', 'capabilities missing');
  return `${response.status} ${body.persistence.status}`;
});
await check('browser security headers', async () => {
  const response = await fetch(`${base}/health`);
  requireValue(Boolean(response.headers.get('content-security-policy')), 'CSP missing');
  requireValue(response.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
  requireValue(Boolean(response.headers.get('referrer-policy')), 'referrer policy missing');
  return 'present';
});
await check('hostile browser origin refused', async () => {
  const response = await fetch(`${base}/health`, { headers: { origin: 'https://not-sface.invalid' } });
  requireValue(response.status === 403, `expected 403, received ${response.status}`);
  requireValue(!response.headers.get('access-control-allow-origin'), 'hostile origin received CORS access');
  return '403';
});
await check('admin requires token', async () => {
  const response = await fetch(`${base}/admin/api/overview`, { cache: 'no-store' });
  requireValue(response.status === 401, `expected 401, received ${response.status}`);
  requireValue(response.headers.get('cache-control')?.includes('no-store'), 'admin response is cacheable');
  return '401 no-store';
});
if (adminToken) {
  await check('admin token works', async () => {
    const response = await fetch(`${base}/admin/api/overview`, { cache: 'no-store', headers: { authorization: `Bearer ${adminToken}` } });
    requireValue(response.ok, `received ${response.status}`);
    const body = await response.json();
    requireValue(typeof body.restartSupported === 'boolean', 'restart capability missing');
    return `restartSupported=${body.restartSupported}`;
  });
}

for (const result of checks) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`);
if (checks.some((result) => !result.ok)) process.exitCode = 1;
