import type { FastifyInstance } from 'fastify';
import { PING_INTERVAL_MS, WsClientMessage, type WsServerMessage } from '@bahn/shared';

const PONG_TIMEOUT_MS = 60_000;

export function registerWsRoutes(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket) => {
    let seq = 0;
    const pending = new Map<number, number>();
    let timeoutHandle: NodeJS.Timeout;

    const send = (msg: WsServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };

    const resetWatchdog = () => {
      clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => socket.close(), PONG_TIMEOUT_MS);
    };

    const pingInterval = setInterval(() => {
      seq += 1;
      pending.set(seq, Date.now());
      send({ t: 'ping', seq });
    }, PING_INTERVAL_MS);

    resetWatchdog();
    send({ t: 'hello', serverTime: Date.now() });

    socket.on('message', (data: Buffer) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      const result = WsClientMessage.safeParse(parsedJson);
      if (!result.success) return;
      const msg = result.data;
      if (msg.t === 'pong') {
        const sentAt = pending.get(msg.seq);
        pending.delete(msg.seq);
        resetWatchdog();
        if (sentAt !== undefined) {
          send({ t: 'rtt', seq: msg.seq, rttMs: Date.now() - sentAt });
        }
      } else if (msg.t === 'sync') {
        const t1 = Date.now();
        send({ t: 'sync', cid: msg.cid, t0: msg.t0, t1, t2: Date.now() });
      }
    });

    socket.on('close', () => {
      clearInterval(pingInterval);
      clearTimeout(timeoutHandle);
    });
  });
}
