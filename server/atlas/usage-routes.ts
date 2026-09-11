import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { ATLAS_USAGE_EVENTS } from '../../shared/atlas/usage';
import type { AtlasUsageService } from './usage';

/*
 * The body is the entire surface this endpoint accepts. It is a closed schema
 * with `.strict()` so an unexpected field is a 400 rather than something we
 * quietly store: the point of this endpoint is to produce a number we can
 * defend, and that starts with knowing exactly what was allowed in.
 *
 * Note what is absent and cannot be sent: wallet address, IP, user agent,
 * display name, or any free text. The device hint is a two-value enum.
 */
const usageEventSchema = z
  .object({
    name: z.enum(ATLAS_USAGE_EVENTS),
    session: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/),
    chapter: z.number().int().min(0).max(6).optional(),
    device: z.enum(['phone', 'desktop']).optional(),
  })
  .strict();

export function mountAtlasUsageRoutes(options: {
  app: Express;
  limit: (maximum: number, refillPerMinute: number) => RequestHandler;
  usage: AtlasUsageService;
  reportEnabled?: boolean;
}): void {
  /*
   * Deliberately generous but finite. A real session emits on the order of ten
   * events; the cap is there so the endpoint cannot be used to grow our state
   * file, not to police honest play. The service caps per session as well.
   */
  options.app.post('/atlas/api/usage', options.limit(60, 30), async (request, response) => {
    const parsed = usageEventSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ ok: false, error: 'invalid-usage-event' });
      return;
    }
    await options.usage.record(parsed.data);
    response.setHeader('cache-control', 'no-store');
    response.status(202).json({ ok: true });
  });

  /*
   * Public on purpose. The competition asks us to show real usage, and a
   * number we publish and can be checked against is worth more than one only
   * we can see. It exposes aggregates only: no session ids, hashed or
   * otherwise, ever leave this process.
   */
  if (options.reportEnabled !== false) {
    options.app.get('/atlas/api/usage/report', options.limit(60, 20), async (_request, response) => {
      response.setHeader('cache-control', 'public, max-age=60');
      response.json({ ok: true, data: await options.usage.summary() });
    });
  }
}
