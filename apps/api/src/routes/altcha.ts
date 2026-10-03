import type { FastifyInstance } from 'fastify';
import { createAltchaChallenge } from '../lib/altcha.js';

export function registerAltchaRoutes(app: FastifyInstance): void {
  app.get('/api/altcha/challenge', async (_request, reply) => {
    const challenge = await createAltchaChallenge(app.ctx.cfg.APP_SECRET);
    reply.send(challenge);
  });
}
