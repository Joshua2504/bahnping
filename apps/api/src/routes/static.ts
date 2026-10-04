import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyHttpProxy from '@fastify/http-proxy';
import WebSocket from 'ws';

/**
 * Liefert optional das Web-Build (`WEB_DIST`, mit SPA-Fallback), die Kacheln (`TILES_DIR`,
 * mit Range-Support) und proxyt `/mailpit` auf Mailpit. Pfade sind relativ zu `apps/api`.
 */
export function registerStaticRoutes(app: FastifyInstance, apiRoot: string): void {
  const { cfg } = app.ctx;
  const reservedPrefixes = ['/api', '/ws', '/mailpit', '/tiles', '/dl'];

  let webDist: string | undefined;
  if (cfg.WEB_DIST) {
    const resolved = path.resolve(apiRoot, cfg.WEB_DIST);
    if (existsSync(resolved)) {
      webDist = resolved;
    } else {
      app.log.warn({ path: resolved }, 'WEB_DIST nicht gefunden, liefere kein Web-Build aus');
    }
  }

  if (webDist) {
    app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: true });
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? '';
      const isReserved = reservedPrefixes.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
      if (request.method !== 'GET' || isReserved) {
        reply
          .code(404)
          .header('content-type', 'application/problem+json')
          .send({ type: 'about:blank', title: 'Nicht gefunden', status: 404 });
        return;
      }
      reply.sendFile('index.html', webDist);
    });
  } else {
    app.setNotFoundHandler((request, reply) => {
      reply
        .code(404)
        .header('content-type', 'application/problem+json')
        .send({ type: 'about:blank', title: 'Nicht gefunden', status: 404 });
    });
  }

  if (cfg.TILES_DIR) {
    const resolved = path.resolve(apiRoot, cfg.TILES_DIR);
    if (existsSync(resolved)) {
      app.register(fastifyStatic, {
        root: resolved,
        prefix: '/tiles/',
        decorateReply: !webDist,
        acceptRanges: true,
      });
    } else {
      app.log.warn({ path: resolved }, 'TILES_DIR nicht gefunden, liefere keine Kacheln aus');
    }
  }

  if (cfg.MAILPIT_UPSTREAM) {
    // HTTP-Proxy ohne eigenes WebSocket-Handling: Das Upgrade-Handling von @fastify/http-proxy
    // kollidiert mit @fastify/websocket (ERR_HTTP_SOCKET_ASSIGNED bringt den Prozess zum Absturz).
    app.register(fastifyHttpProxy, {
      upstream: cfg.MAILPIT_UPSTREAM,
      prefix: '/mailpit',
      rewritePrefix: '/mailpit',
      websocket: false,
    });
    // Mailpit-Live-Updates: einzige WebSocket-Route von Mailpit, über @fastify/websocket weitergereicht.
    const upstreamWs = cfg.MAILPIT_UPSTREAM.replace(/^http/, 'ws') + '/mailpit/api/events';
    app.get('/mailpit/api/events', { websocket: true }, (client, request) => {
      const headers: Record<string, string> = {};
      if (request.headers.authorization) headers.authorization = request.headers.authorization;
      const upstream = new WebSocket(upstreamWs, { headers });
      const pending: WebSocket.RawData[] = [];
      upstream.on('open', () => {
        for (const m of pending.splice(0)) upstream.send(m);
      });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === client.OPEN) client.send(data, { binary: isBinary });
      });
      client.on('message', (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else pending.push(data);
      });
      const closeBoth = () => {
        if (client.readyState === client.OPEN) client.close();
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      };
      upstream.on('close', closeBoth);
      upstream.on('error', closeBoth);
      upstream.on('unexpected-response', closeBoth);
      client.on('close', closeBoth);
      client.on('error', closeBoth);
    });
  }
}
