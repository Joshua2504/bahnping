import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async (_request, reply) => {
    const { db, asn } = app.ctx;
    let dbOk = true;
    try {
      await db.execute(sql`select 1`);
    } catch (err) {
      dbOk = false;
      app.log.error({ err: String(err) }, 'DB-Healthcheck fehlgeschlagen');
    }
    reply.send({ ok: dbOk, db: dbOk, asnRanges: asn.rangeCount, time: Date.now() });
  });
}
