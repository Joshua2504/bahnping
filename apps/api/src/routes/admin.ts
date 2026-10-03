import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AdminAsnUpdate, type AdminAsn } from '@bahn/shared';
import { asnCatalog, samples } from '../db/schema.js';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';

function toAdminAsn(row: {
  asn: number;
  name: string;
  netClass: string;
  source: string;
  seen: number;
  reviewedAt: Date | null;
  samples: number;
  trips: number;
}): AdminAsn {
  return {
    asn: row.asn,
    name: row.name,
    netClass: row.netClass as AdminAsn['netClass'],
    source: row.source,
    seen: row.seen,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    samples: row.samples,
    trips: row.trips,
  };
}

export function registerAdminRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;

  app.get('/api/admin/asns', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { filter } = request.query as { filter?: string };
    const onlyUnknown = filter === 'unknown';

    const rows = await db
      .select({
        asn: asnCatalog.asn,
        name: asnCatalog.name,
        netClass: asnCatalog.netClass,
        source: asnCatalog.source,
        seen: asnCatalog.seen,
        reviewedAt: asnCatalog.reviewedAt,
        samples: sql<number>`count(${samples.id})`.as('n_samples'),
        trips: sql<number>`count(distinct ${samples.tripId})`.as('n_trips'),
      })
      .from(asnCatalog)
      .leftJoin(samples, eq(samples.asn, asnCatalog.asn))
      .where(onlyUnknown ? eq(asnCatalog.netClass, 'unknown') : undefined)
      .groupBy(asnCatalog.asn)
      .orderBy(desc(asnCatalog.seen));

    reply.send(rows.map((r) => toAdminAsn({ ...r, samples: Number(r.samples), trips: Number(r.trips) })));
  });

  app.patch('/api/admin/asns/:asn', { preHandler: app.requireAdmin }, async (request, reply) => {
    const { asn: asnParam } = request.params as { asn: string };
    const asnNum = Number(asnParam);
    if (!Number.isFinite(asnNum)) {
      sendProblem(reply, 400, 'Ungültige ASN');
      return;
    }
    const body = parseOrProblem(AdminAsnUpdate, request.body, reply);
    if (!body) return;

    const existing = await db.select().from(asnCatalog).where(eq(asnCatalog.asn, asnNum)).limit(1);
    if (!existing[0]) {
      sendProblem(reply, 404, 'ASN nicht bekannt');
      return;
    }

    const updated = await db
      .update(asnCatalog)
      .set({ netClass: body.netClass, source: 'admin', reviewedAt: new Date() })
      .where(eq(asnCatalog.asn, asnNum))
      .returning();
    const row = updated[0];

    app.ctx.asn.setClass(asnNum, { netClass: body.netClass, name: row.name });

    // Nur Samples ohne net_sig_invalid-Flag aktualisieren (ungültig signierte Samples bleiben unknown).
    const changed = await db
      .update(samples)
      .set({ netClass: body.netClass })
      .where(and(eq(samples.asn, asnNum), sql`NOT (${samples.flags} @> ARRAY['net_sig_invalid']::text[])`))
      .returning({ id: samples.id });

    const countRows = await db
      .select({
        samples: sql<number>`count(${samples.id})`.as('n_samples'),
        trips: sql<number>`count(distinct ${samples.tripId})`.as('n_trips'),
      })
      .from(samples)
      .where(eq(samples.asn, asnNum));

    reply.send({
      asn: toAdminAsn({
        ...row,
        samples: Number(countRows[0]?.samples ?? 0),
        trips: Number(countRows[0]?.trips ?? 0),
      }),
      samplesUpdated: changed.length,
    });
  });
}
