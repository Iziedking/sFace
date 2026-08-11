import type { Express, RequestHandler, Response } from 'express';
import * as xauth from './xauth';

export interface XAuthRoutesDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  allowedOrigins: readonly string[];
}

export function mountXAuthRoutes(deps: XAuthRoutesDeps): void {
  const { app, limit, allowedOrigins } = deps;

  app.get('/x/config', (_req, res) => {
    res.json({ enabled: xauth.xauthConfigured() });
  });

  app.post('/x/start', limit(20, 8), (req, res) => {
    const asked = typeof req.body?.returnTo === 'string' ? req.body.returnTo : '';
    const returnTo = allowedOrigins.includes(asked) ? asked : (allowedOrigins[0] ?? '');
    if (!returnTo) {
      res.status(500).json({ error: 'No allowed origin is configured.' });
      return;
    }
    const result = xauth.begin(returnTo);
    if (!result.ok) {
      res.status(result.code).json({ error: result.reason });
      return;
    }
    res.json(result.value);
  });

  app.get('/x/callback', limit(30, 12), async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (typeof req.query.error === 'string') {
      handOff(res, xauth.returnAddress(state), { ok: false, reason: 'declined' }, allowedOrigins);
      return;
    }
    if (!state || !code) {
      handOff(res, null, { ok: false, reason: 'bad_request' }, allowedOrigins);
      return;
    }
    const returnTo = xauth.returnAddress(state);
    const result = await xauth.complete(state, code);
    const payload = result.ok
      ? { ok: true as const, profile: result.value }
      : { ok: false as const, reason: result.reason };
    handOff(res, returnTo, payload, allowedOrigins);
  });
}

function handOff(res: Response, returnTo: string | null, payload: unknown, allowedOrigins: readonly string[]): void {
  const target = returnTo ?? allowedOrigins[0] ?? '';
  if (!target) {
    res.type('html').send(closingPage(payload, allowedOrigins[0] ?? '*'));
    return;
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  res.redirect(302, `${target}/#sface-x=${encoded}`);
}

function closingPage(payload: unknown, origin: string): string {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>sFace</title>
<body style="background:#f4ede0;color:#14110e;font:600 15px system-ui;display:grid;place-items:center;height:100vh;margin:0">
<p>You can close this window.</p>
<script>
  (function () {
    var payload = ${json};
    try { window.opener && window.opener.postMessage({ source: 'sface-x', payload: payload }, ${JSON.stringify(origin)}); } catch (e) {}
    setTimeout(function () { window.close(); }, 400);
  })();
</script>`;
}
