import type { FastifyReply } from 'fastify';
import type { ZodType } from 'zod';
import { sendProblem } from './problem.js';

/**
 * Validiert `data` gegen ein Zod-Schema aus `@bahn/shared`. Bei Fehlern wird direkt eine
 * 400-Problem-Details-Antwort gesendet und `undefined` zurückgegeben (Aufrufer muss dann abbrechen).
 */
export function parseOrProblem<T>(schema: ZodType<T>, data: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(data);
  if (!result.success) {
    sendProblem(reply, 400, 'Validierungsfehler', { errors: result.error.issues });
    return undefined;
  }
  return result.data;
}
