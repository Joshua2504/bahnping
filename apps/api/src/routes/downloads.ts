import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

/**
 * Liefert die CLI-Binaries unter `/dl/<dateiname>` aus (z.B. `/dl/bahnnet-linux-amd64`), als Download
 * erzwungen (`Content-Disposition: attachment`) und ohne Zwischen-Caching, damit neue Builds sofort
 * ankommen. `DOWNLOADS_DIR` ist relativ zu `apps/api`; fehlt das Verzeichnis, wird nur gewarnt.
 */
export function registerDownloadRoutes(app: FastifyInstance, apiRoot: string): void {
  const { cfg } = app.ctx;
  const resolved = path.resolve(apiRoot, cfg.DOWNLOADS_DIR);
  if (!existsSync(resolved)) {
    app.log.warn({ path: resolved }, 'DOWNLOADS_DIR nicht gefunden, liefere keine CLI-Downloads aus');
    return;
  }
  app.register(fastifyStatic, {
    root: resolved,
    prefix: '/dl/',
    decorateReply: false,
    setHeaders: (res, filePath) => {
      res.setHeader('content-disposition', `attachment; filename="${path.basename(filePath)}"`);
      res.setHeader('cache-control', 'no-cache');
    },
  });
}
