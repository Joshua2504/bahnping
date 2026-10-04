import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ConfirmRequest, MagicLinkRequest, MAGIC_LINK_TTL_MS, type Me } from '@bahn/shared';
import { magicLinks, users } from '../db/schema.js';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';
import { verifyAltchaSolution } from '../lib/altcha.js';
import { allowMagicLinkSend, sendMagicLinkMail } from '../lib/mail.js';
import { ensureAdminRole } from '../lib/admin.js';
import {
  createSession,
  deleteAllSessionsForUser,
  deleteSessionByToken,
  generateToken,
  sessionCookieOptions,
  sha256Hex,
} from '../lib/auth.js';

function toMe(row: typeof users.$inferSelect): Me {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role as Me['role'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const { cfg, db, mail } = app.ctx;

  app.post('/api/auth/magic-link', async (request, reply) => {
    const body = parseOrProblem(MagicLinkRequest, request.body, reply);
    if (!body) return;
    // Ab hier IMMER 204 (keine Nutzer-Enumeration, keine Fehlerdetails nach außen).
    try {
      const altchaOk = await verifyAltchaSolution(cfg.APP_SECRET, body.altcha);
      if (!altchaOk) {
        reply.code(204).send();
        return;
      }
      if (!allowMagicLinkSend(body.email)) {
        reply.code(204).send();
        return;
      }
      const token = generateToken();
      const tokenHash = sha256Hex(token);
      await db.insert(magicLinks).values({
        tokenHash,
        email: body.email.toLowerCase(),
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      });
      const confirmUrl = `${cfg.PUBLIC_URL}/auth/confirm?token=${token}`;
      await sendMagicLinkMail(mail, body.email, confirmUrl);
    } catch (err) {
      request.log.warn({ err: String(err) }, 'Magic-Link-Versand fehlgeschlagen');
    }
    reply.code(204).send();
  });

  app.post('/api/auth/confirm', async (request, reply) => {
    const body = parseOrProblem(ConfirmRequest, request.body, reply);
    if (!body) return;
    const tokenHash = sha256Hex(body.token);
    const rows = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, tokenHash)).limit(1);
    const link = rows[0];
    if (!link || link.consumedAt || link.expiresAt.getTime() < Date.now()) {
      sendProblem(reply, 400, 'Ungültiger oder abgelaufener Link');
      return;
    }
    await db.update(magicLinks).set({ consumedAt: new Date() }).where(eq(magicLinks.tokenHash, tokenHash));

    const userRows = await db.select().from(users).where(eq(users.email, link.email)).limit(1);
    let user = userRows[0];
    if (!user) {
      const inserted = await db.insert(users).values({ email: link.email }).returning();
      user = inserted[0];
    }
    const role = await ensureAdminRole(db, cfg, user.id, user.email, user.role);
    if (role !== user.role) user = { ...user, role };

    const { token, expiresAt } = await createSession(db, user.id, null);
    reply.setCookie('bt_session', token, sessionCookieOptions(cfg.PUBLIC_URL, expiresAt.getTime() - Date.now()));
    reply.send(toMe(user));
  });

  app.post('/api/auth/logout', { preHandler: app.requireAuth }, async (request, reply) => {
    if (request.sessionToken) {
      await deleteSessionByToken(db, request.sessionToken);
    }
    reply.clearCookie('bt_session', { path: '/' });
    reply.code(204).send();
  });

  app.post('/api/auth/logout-all', { preHandler: app.requireAuth }, async (request, reply) => {
    await deleteAllSessionsForUser(db, request.userId!);
    reply.clearCookie('bt_session', { path: '/' });
    reply.code(204).send();
  });
}
