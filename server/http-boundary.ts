import express, { type Express } from 'express';

import { corsDecision } from './cors';
import { apiSecurityHeaders } from './security-headers';

export interface HttpBoundaryOptions {
  allowedOrigins: readonly string[];
  production: boolean;
  trustProxy: boolean;
  networkHeader: string;
}

export function allowedRequestHeaders(networkHeader: string): string {
  return `content-type, authorization, ${networkHeader}`;
}

export function installHttpBoundary(app: Express, options: HttpBoundaryOptions): void {
  if (options.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(apiSecurityHeaders())) res.setHeader(name, value);
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    const cors = corsDecision(req.headers.origin, options.allowedOrigins, options.production);
    if (!cors.allowed) {
      res.status(403).json({ error: 'Origin is not allowed.' });
      return;
    }
    if (cors.header) {
      res.setHeader('access-control-allow-origin', cors.header);
      if (cors.header !== '*') res.setHeader('vary', 'Origin');
    }
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('access-control-allow-headers', allowedRequestHeaders(options.networkHeader));
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}
