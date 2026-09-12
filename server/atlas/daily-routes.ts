import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import type { AtlasDailyService } from './daily';

/*
 * The daily run: answer today's challenge, qualify, share the day's pot.
 *
 * The schema is closed. Everything a player could gain by lying about — the
 * payment, the consensus reading, the validator spread — is re-checked by the
 * service against the server's own configuration, so a crafted body cannot
 * qualify a wallet. The body is the player's *claim*; eligibility is the
 * server's finding.
 */
const paymentSchema = z
  .object({
    txHash: z.string().min(4).max(128).optional(),
    network: z.string().min(2).max(32).optional(),
    recipient: z.string().min(4).max(64).optional(),
    valueLuna: z.number().int().nonnegative().optional(),
    canonical: z.boolean().optional(),
    success: z.boolean().optional(),
    confirmations: z.number().int().nonnegative().optional(),
  })
  .strict();

const submitSchema = z
  .object({
    actorId: z.string().min(4).max(96),
    walletAddress: z.string().min(4).max(64),
    deviceIdentifier: z.string().min(1).max(96).optional(),
    challengeId: z.string().regex(/^daily-\d{2}$/),
    answer: z.string().min(1).max(80),
    replayComplete: z.boolean(),
    assistance: z.enum(['none', 'free-hint', 'purchased-hint', 'answer-reveal', 'debug']),
    payment: paymentSchema.optional(),
    consensus: z.object({ established: z.boolean(), observedAt: z.number().int() }).strict().optional(),
    validatorDistribution: z.object({ distinctValidators: z.number().int(), totalValidators: z.number().int() }).strict().optional(),
    recovery: z.enum(['wallet-cancelled', 'offline', 'retryable-rpc']).optional(),
  })
  .strict();

const obligationSchema = z
  .object({
    actorId: z.string().min(4).max(96),
    walletAddress: z.string().min(4).max(64),
    challengeId: z.string().regex(/^daily-\d{2}$/),
  })
  .strict();

export function mountAtlasDailyRoutes(options: {
  app: Express;
  limit: (maximum: number, refillPerMinute: number) => RequestHandler;
  daily?: AtlasDailyService;
}): void {
  const unavailable = (response: Parameters<RequestHandler>[1]) => {
    response.status(503).json({ ok: false, error: 'Atlas daily runs are unavailable.' });
  };

  /*
   * Public, and deliberately honest about rewards.
   *
   * `rewardsEnabled` is false until a treasury is configured, and the client
   * shows that rather than a number. Advertising a share that nothing can pay
   * is the exact failure this codebase already fixed once in the treasury.
   */
  options.app.get('/atlas/api/daily/standing', options.limit(120, 40), async (_request, response) => {
    if (!options.daily) return unavailable(response);
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.daily.standing() });
  });

  options.app.post('/atlas/api/daily/submit', options.limit(20, 8), async (request, response) => {
    if (!options.daily) return unavailable(response);
    const parsed = submitSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ ok: false, error: 'invalid-daily-submission' });
      return;
    }
    const result = await options.daily.submit(parsed.data);
    response.setHeader('cache-control', 'no-store');
    // A refusal is a normal answer here, not an error: the player asked whether
    // they qualified and the server said no, with a reason they can act on.
    response.status(200).json({ ok: true, data: result });
  });

  options.app.post('/atlas/api/daily/obligation', options.limit(40, 15), async (request, response) => {
    if (!options.daily) return unavailable(response);
    const parsed = obligationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ ok: false, error: 'invalid-obligation-request' });
      return;
    }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.daily.pendingObligation(parsed.data) });
  });
}
