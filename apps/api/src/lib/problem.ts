import type { FastifyReply } from 'fastify';

/** Sendet eine RFC-9457-Problem-Details-Antwort (`application/problem+json`). */
export function sendProblem(
  reply: FastifyReply,
  status: number,
  title: string,
  opts: { detail?: string; errors?: unknown; type?: string } = {},
): FastifyReply {
  return reply
    .code(status)
    .header('content-type', 'application/problem+json')
    .send({
      type: opts.type ?? 'about:blank',
      title,
      status,
      ...(opts.detail ? { detail: opts.detail } : {}),
      ...(opts.errors !== undefined ? { errors: opts.errors } : {}),
    });
}
