import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AdminAsnUpdate, SmtpSettingsUpdate, SmtpTestRequest, type AdminAsn, type SmtpSettings } from '@bahn/shared';
import { asnCatalog, samples, users } from '../db/schema.js';
import { loadSmtpSettings, saveSmtpSettings, type StoredSmtpSettings } from '../lib/smtpSettings.js';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';


function toSmtpSettings(stored: StoredSmtpSettings | null, envDefaults: { host: string; port: number; from: string }): SmtpSettings {
  return {
    mode: stored?.mode ?? 'env',
    host: stored?.host ?? envDefaults.host,
    port: stored?.port ?? envDefaults.port,
    security: stored?.security ?? 'none',
    user: stored?.user ?? '',
    from: stored?.from ?? envDefaults.from,
    rejectUnauthorized: stored?.rejectUnauthorized ?? true,
    passwordSet: Boolean(stored?.passwordEnc),
    envDefaults,
  };
}

/** Leitet aus einem SMTP-/Nodemailer-Fehler eine verständliche, nicht geheimnisverratende Meldung ab. */
function describeSmtpError(err: unknown): string {
  const code = (err as { code?: string; responseCode?: number } | undefined)?.code;
  const responseCode = (err as { responseCode?: number } | undefined)?.responseCode;
  if (code === 'EAUTH' || responseCode === 535) return 'Authentifizierung fehlgeschlagen (Benutzer/Passwort prüfen).';
  if (code === 'ECONNREFUSED') return 'Verbindung abgelehnt (Host/Port prüfen).';
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') return 'Zeitüberschreitung bei der Verbindung zum SMTP-Server.';
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return 'Zertifikat des SMTP-Servers ungültig.';
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/certificate/i.test(message)) return 'Zertifikat des SMTP-Servers ungültig.';
  if (/timed? ?out/i.test(message)) return 'Zeitüberschreitung bei der Verbindung zum SMTP-Server.';
  return 'Verbindung zum SMTP-Server fehlgeschlagen.';
}

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

  app.get('/api/admin/smtp', { preHandler: app.requireAdmin }, async (_request, reply) => {
    const stored = await loadSmtpSettings(db);
    const envDefaults = { host: app.ctx.cfg.SMTP_HOST, port: app.ctx.cfg.SMTP_PORT, from: app.ctx.cfg.MAIL_FROM };
    reply.send(toSmtpSettings(stored, envDefaults));
  });

  app.put('/api/admin/smtp', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseOrProblem(SmtpSettingsUpdate, request.body, reply);
    if (!body) return;

    const stored = await saveSmtpSettings(db, app.ctx.cfg.APP_SECRET, body, request.userId!);
    await app.ctx.mail.reload();

    const envDefaults = { host: app.ctx.cfg.SMTP_HOST, port: app.ctx.cfg.SMTP_PORT, from: app.ctx.cfg.MAIL_FROM };
    reply.send(toSmtpSettings(stored, envDefaults));
  });

  app.post('/api/admin/smtp/test', { preHandler: app.requireAdmin }, async (request, reply) => {
    const body = parseOrProblem(SmtpTestRequest, request.body ?? {}, reply);
    if (!body) return;

    // Bewusst ohne Rate-Limit: Der Endpunkt ist nur für Admins erreichbar.

    let to = body.to;
    if (!to) {
      const rows = await db.select({ email: users.email }).from(users).where(eq(users.id, request.userId!)).limit(1);
      to = rows[0]?.email;
    }
    if (!to) {
      sendProblem(reply, 400, 'Keine Empfängeradresse bekannt');
      return;
    }

    const { mail } = app.ctx;
    try {
      await mail.getTransporter().verify();
      const { messageId } = await mail.send({
        to,
        subject: 'Testmail – BahnPing',
        text: 'Dies ist eine Testmail zur Überprüfung der SMTP-Konfiguration des BahnPing.\n\nWenn du diese Mail erhalten hast, funktioniert der Mailversand.',
        html: '<p>Dies ist eine Testmail zur Überprüfung der SMTP-Konfiguration des BahnPing.</p><p>Wenn du diese Mail erhalten hast, funktioniert der Mailversand.</p>',
      });
      reply.send({ ok: true, messageId });
    } catch (err) {
      request.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'SMTP-Testmail fehlgeschlagen');
      sendProblem(reply, 502, 'Testmail konnte nicht gesendet werden', { detail: describeSmtpError(err) });
    }
  });
}
