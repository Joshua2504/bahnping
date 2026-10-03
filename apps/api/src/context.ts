import type postgres from 'postgres';
import type { Transporter } from 'nodemailer';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { AsnService } from './lib/asn.js';

/** 4 MiB Zufallsdaten für den Download-Speedtest, einmal beim Start erzeugt. */
export const SPEEDTEST_BUFFER_SIZE = 4 * 1024 * 1024;

export interface AppContext {
  cfg: Config;
  db: Db;
  dbClient: postgres.Sql;
  mailer: Transporter;
  asn: AsnService;
  speedBuffer: Buffer;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Vom globalen Auth-Hook gesetzt, falls Session-Cookie oder Bearer-Token gültig war. */
    userId?: string;
    authMethod?: 'cookie' | 'token';
    /** Klartext-Session-Token aus dem Cookie (nur für logout nötig, wird nie gespeichert). */
    sessionToken?: string;
  }
  interface FastifyInstance {
    ctx: AppContext;
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
