import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { ApiTokenCreate, type ApiTokenInfo } from '@bahn/shared';
import { apiTokens } from '../db/schema.js';
import { generateToken, sha256Hex } from '../lib/auth.js';
import { verifyAltchaSolution } from '../lib/altcha.js';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';

/** Länge des Token-Hash-Präfixes, das als öffentliche, nicht geheime ID dient (siehe `/api/tokens`). */
const ID_LENGTH = 12;
const MAX_ACTIVE_TOKENS = 20;

function toTokenInfo(row: typeof apiTokens.$inferSelect): ApiTokenInfo {
  return {
    id: row.tokenHash.slice(0, ID_LENGTH),
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

/**
 * API-Tokens für CLI/App. Nur über Sitzungs-Login verwaltbar (`requireCookieAuth`): ein
 * gestohlenes API-Token darf sich selbst nicht verlängern oder weitere Tokens anlegen können.
 */
export function registerTokenRoutes(app: FastifyInstance): void {
  const { db, cfg } = app.ctx;

  app.get('/api/tokens', { preHandler: [app.requireAuth, app.requireCookieAuth] }, async (request, reply) => {
    const rows = await db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, request.userId!), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt));
    reply.send(rows.map(toTokenInfo));
  });

  app.post('/api/tokens', { preHandler: [app.requireAuth, app.requireCookieAuth] }, async (request, reply) => {
    const body = parseOrProblem(ApiTokenCreate, request.body, reply);
    if (!body) return;
    const altchaOk = await verifyAltchaSolution(cfg.APP_SECRET, body.altcha);
    if (!altchaOk) {
      sendProblem(reply, 400, 'ALTCHA-Prüfung fehlgeschlagen');
      return;
    }

    const countRows = await db
      .select({ n: sql<number>`count(*)`.as('n') })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, request.userId!), isNull(apiTokens.revokedAt)));
    if (Number(countRows[0]?.n ?? 0) >= MAX_ACTIVE_TOKENS) {
      sendProblem(reply, 400, 'Zu viele aktive Tokens', {
        detail: `Maximal ${MAX_ACTIVE_TOKENS} aktive Tokens je Nutzer. Bitte zuerst ein ungenutztes Token widerrufen.`,
      });
      return;
    }

    const token = `bnt_${generateToken()}`;
    const tokenHash = sha256Hex(token);
    const inserted = await db
      .insert(apiTokens)
      .values({ tokenHash, userId: request.userId!, name: body.name })
      .returning();
    reply.code(201).send({ ...toTokenInfo(inserted[0]), token });
  });

  app.delete('/api/tokens/:id', { preHandler: [app.requireAuth, app.requireCookieAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!/^[0-9a-f]{12}$/.test(id)) {
      sendProblem(reply, 404, 'Token nicht gefunden');
      return;
    }
    const updated = await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.userId, request.userId!), isNull(apiTokens.revokedAt), like(apiTokens.tokenHash, `${id}%`)))
      .returning({ tokenHash: apiTokens.tokenHash });
    if (updated.length === 0) {
      sendProblem(reply, 404, 'Token nicht gefunden');
      return;
    }
    reply.code(204).send();
  });
}
