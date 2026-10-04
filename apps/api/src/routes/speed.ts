import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { SPEEDTEST_COOLDOWN_MS, SPEEDTEST_MAX_BYTES } from '@bahn/shared';
import { sendProblem } from '../lib/problem.js';

/** Letzter Testbeginn je Nutzer, nur im RAM (Quota, kein Persistenzbedarf in der Testversion). */
const lastStart = new Map<string, number>();

export function registerSpeedRoutes(app: FastifyInstance): void {
  const { speedBuffer } = app.ctx;

  // Upload-Body nur zählen und verwerfen, nie im RAM sammeln.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    let bytes = 0;
    let finished = false;
    const finish = (err: Error | null) => {
      if (finished) return;
      finished = true;
      done(err, { bytes });
    };
    payload.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > SPEEDTEST_MAX_BYTES) {
        payload.destroy();
        finish(Object.assign(new Error('Upload zu groß'), { statusCode: 413 }));
      }
    });
    payload.on('end', () => finish(null));
    // Abbruch durch den Client (Testdauer abgelaufen) ist erwartet und kein Serverfehler.
    payload.on('error', (err) => finish(Object.assign(err, { statusCode: 400 })));
  });

  app.post('/api/speed/start', { preHandler: app.requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const now = Date.now();
    const last = lastStart.get(userId);
    if (last !== undefined && now - last < SPEEDTEST_COOLDOWN_MS) {
      const retryAfterS = Math.ceil((SPEEDTEST_COOLDOWN_MS - (now - last)) / 1000);
      reply.header('retry-after', String(retryAfterS));
      sendProblem(reply, 429, 'Zu viele Speedtests', { detail: `Bitte ${retryAfterS}s warten` });
      return;
    }
    lastStart.set(userId, now);
    reply.code(204).send();
  });

  app.get('/api/speed/down', { preHandler: app.requireAuth }, async (request, reply) => {
    const bytesParam = (request.query as { bytes?: string }).bytes;
    const bytes = Number(bytesParam);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > SPEEDTEST_MAX_BYTES) {
      sendProblem(reply, 400, 'Ungültige Byte-Anzahl', { detail: `bytes muss zwischen 0 und ${SPEEDTEST_MAX_BYTES} liegen` });
      return;
    }
    const n = Math.floor(bytes);
    // Aus dem Zufallspuffer streamen statt n Bytes am Stück zu allokieren.
    const chunkSize = 64 * 1024;
    let offset = 0;
    const stream = Readable.from(
      (function* () {
        while (offset < n) {
          const len = Math.min(chunkSize, n - offset);
          const start = offset % (speedBuffer.length - chunkSize);
          offset += len;
          yield speedBuffer.subarray(start, start + len);
        }
      })(),
    );
    // Bei Streams in async-Handlern muss reply zurückgegeben werden, sonst endet die Antwort leer.
    return reply
      .header('cache-control', 'no-store')
      .header('content-encoding', 'identity')
      .header('content-length', String(n))
      .type('application/octet-stream')
      .send(stream);
  });

  app.post(
    '/api/speed/up',
    { preHandler: app.requireAuth, bodyLimit: SPEEDTEST_MAX_BYTES },
    async (request, reply) => {
      const body = request.body as { bytes: number } | undefined;
      reply.send({ bytes: body?.bytes ?? 0 });
    },
  );
}
