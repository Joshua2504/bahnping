import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ne } from 'drizzle-orm';
import { MeUpdate, type Me } from '@bahn/shared';
import { samples, trips, users } from '../db/schema.js';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';
import { verifyAltchaSolution } from '../lib/altcha.js';
import { ensureAdminRole } from '../lib/admin.js';

function toMe(row: typeof users.$inferSelect): Me {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as Me['role'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerMeRoutes(app: FastifyInstance): void {
  const { db, cfg } = app.ctx;

  app.get('/api/me', { preHandler: app.requireAuth }, async (request, reply) => {
    const rows = await db.select().from(users).where(eq(users.id, request.userId!)).limit(1);
    let user = rows[0];
    if (!user) {
      sendProblem(reply, 401, 'Nicht angemeldet');
      return;
    }
    const role = await ensureAdminRole(db, cfg, user.id, user.email, user.role);
    if (role !== user.role) user = { ...user, role };
    reply.send(toMe(user));
  });

  app.patch('/api/me', { preHandler: app.requireAuth }, async (request, reply) => {
    const body = parseOrProblem(MeUpdate, request.body, reply);
    if (!body) return;
    const altchaOk = await verifyAltchaSolution(cfg.APP_SECRET, body.altcha);
    if (!altchaOk) {
      sendProblem(reply, 400, 'ALTCHA-Prüfung fehlgeschlagen');
      return;
    }
    const taken = await db
      .select()
      .from(users)
      .where(and(eq(users.displayName, body.displayName), ne(users.id, request.userId!)))
      .limit(1);
    if (taken[0]) {
      sendProblem(reply, 409, 'Name bereits vergeben');
      return;
    }
    try {
      const updated = await db
        .update(users)
        .set({ displayName: body.displayName })
        .where(eq(users.id, request.userId!))
        .returning();
      reply.send(toMe(updated[0]));
    } catch (err) {
      if (String(err).includes('duplicate key')) {
        sendProblem(reply, 409, 'Name bereits vergeben');
        return;
      }
      throw err;
    }
  });

  app.delete('/api/me', { preHandler: [app.requireAuth, app.requireCookieAuth] }, async (request, reply) => {
    await db.delete(users).where(eq(users.id, request.userId!));
    reply.clearCookie('bt_session', { path: '/' });
    reply.code(204).send();
  });

  app.get('/api/me/export', { preHandler: app.requireAuth }, async (request, reply) => {
    const userRows = await db.select().from(users).where(eq(users.id, request.userId!)).limit(1);
    const user = userRows[0];
    if (!user) {
      sendProblem(reply, 401, 'Nicht angemeldet');
      return;
    }
    const tripRows = await db
      .select()
      .from(trips)
      .where(eq(trips.userId, request.userId!))
      .orderBy(desc(trips.startedAt));
    const out = [];
    for (const trip of tripRows) {
      const sampleRows = await db.select().from(samples).where(eq(samples.tripId, trip.id));
      out.push({ ...trip, samples: sampleRows });
    }
    reply.send({ user: toMe(user), trips: out });
  });
}
