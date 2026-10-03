import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import type { AppContext } from './context.js';
import { sendProblem } from './lib/problem.js';
import { sha256Hex } from './lib/auth.js';
import { eq, and, isNull } from 'drizzle-orm';
import { apiTokens, sessions } from './db/schema.js';
import { SESSION_TTL_MS } from '@bahn/shared';
import { registerHealthRoutes } from './routes/health.js';
import { registerAltchaRoutes } from './routes/altcha.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerTripRoutes } from './routes/trips.js';
import { registerNetRoutes } from './routes/net.js';
import { registerWsRoutes } from './routes/ws.js';
import { registerSpeedRoutes } from './routes/speed.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerStaticRoutes } from './routes/static.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
/** Mindestabstand zwischen zwei `lastSeenAt`-Updates einer Session. */
const LAST_SEEN_UPDATE_INTERVAL_MS = 10 * 60_000;

/**
 * Baut die Fastify-App ohne sie zu starten (für `index.ts` und Tests gleichermaßen nutzbar).
 */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: ctx.cfg.TRUST_PROXY,
    bodyLimit: 1024 * 1024, // 1 MiB Standard, /api/speed/up überschreibt das pro Route
    disableRequestLogging: true,
    logger: { level: ctx.cfg.NODE_ENV === 'test' ? 'silent' : 'info' },
  });

  app.decorate('ctx', ctx);

  // Eigener Zugriffslog: nur Methode, Route, Status, Dauer – niemals IP/Header/Query/E-Mail.
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url ?? null,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request',
    );
  });

  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket);

  // --- Auth: lenient global authentication, setzt request.userId/authMethod ---
  app.addHook('onRequest', async (request) => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      if (token) {
        const hash = sha256Hex(token);
        const rows = await ctx.db
          .select()
          .from(apiTokens)
          .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
          .limit(1);
        const row = rows[0];
        if (row) {
          request.userId = row.userId;
          request.authMethod = 'token';
          void ctx.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.tokenHash, hash));
          return;
        }
      }
    }
    const cookieToken = request.cookies?.bt_session;
    if (cookieToken) {
      const hash = sha256Hex(cookieToken);
      const rows = await ctx.db.select().from(sessions).where(eq(sessions.idHash, hash)).limit(1);
      const row = rows[0];
      const now = Date.now();
      if (row && row.expiresAt.getTime() > now) {
        request.userId = row.userId;
        request.authMethod = 'cookie';
        request.sessionToken = cookieToken;
        if (now - row.lastSeenAt.getTime() > LAST_SEEN_UPDATE_INTERVAL_MS) {
          const expiresAt = new Date(now + SESSION_TTL_MS);
          void ctx.db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.idHash, hash));
        }
      }
    }
  });

  // --- CSRF: bei Cookie-Auth und mutierenden Methoden Origin bzw. Sec-Fetch-Site prüfen ---
  app.addHook('preHandler', async (request, reply) => {
    if (request.authMethod !== 'cookie') return;
    if (!MUTATING_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin) {
      const allowed = new URL(ctx.cfg.PUBLIC_URL).origin;
      if (origin !== allowed) {
        sendProblem(reply, 403, 'Ungültige Herkunft', { detail: 'Origin passt nicht zu PUBLIC_URL' });
        return;
      }
      return;
    }
    const secFetchSite = request.headers['sec-fetch-site'];
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      sendProblem(reply, 403, 'Ungültige Herkunft', { detail: 'Sec-Fetch-Site weder same-origin noch none' });
    }
  });

  app.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userId) {
      sendProblem(reply, 401, 'Nicht angemeldet');
    }
  });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: err.message, route: request.routeOptions.url ?? null }, 'unerwarteter Fehler');
    }
    sendProblem(reply, status, status === 500 ? 'Interner Serverfehler' : err.message || 'Fehler', {
      detail: status === 500 ? undefined : err.message,
    });
  });

  registerHealthRoutes(app);
  registerAltchaRoutes(app);
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerTripRoutes(app);
  registerNetRoutes(app);
  registerWsRoutes(app);
  registerSpeedRoutes(app);
  registerPublicRoutes(app);
  registerStaticRoutes(app, path.resolve(import.meta.dirname, '..'));

  return app;
}
