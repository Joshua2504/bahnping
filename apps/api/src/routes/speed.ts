import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import { SPEEDTEST_MAX_BYTES } from '@bahn/shared';
import { sendProblem } from '../lib/problem.js';

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

  // Kein Cooldown mehr (Dauer-Speedtest). Endpunkt bleibt für bestehende Clients, die ihn vor jedem Test aufrufen.
  app.post('/api/speed/start', { preHandler: app.requireAuth }, async (_request, reply) => {
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
