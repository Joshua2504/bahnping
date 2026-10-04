import { gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { latLngToCell } from 'h3-js';
import {
  Sample,
  TripCreate,
  TripEnd,
  TripSamplesQuery,
  TripUpdate,
  type NetClass,
  type Trip,
  type TripSample,
  type TripSamples,
} from '@bahn/shared';
import { asnCatalog, samples, trips } from '../db/schema.js';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';
import { verifyNetToken } from '../lib/netToken.js';
import { isBadAccuracy, isClockSkew, isImplausibleSpeed, isOutOfBbox, type LastPosition } from '../lib/flags.js';
import { normalizeTrainNumber } from '../lib/trainNumber.js';

function toTrip(row: typeof trips.$inferSelect, sampleCount?: number): Trip {
  return {
    id: row.id,
    trainType: row.trainType as Trip['trainType'],
    trainNumber: row.trainNumber,
    platform: row.platform,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    status: row.status as Trip['status'],
    ...(sampleCount !== undefined ? { sampleCount } : {}),
  };
}

export function registerTripRoutes(app: FastifyInstance): void {
  const { db, cfg } = app.ctx;

  app.post('/api/trips', { preHandler: app.requireAuth }, async (request, reply) => {
    const body = parseOrProblem(TripCreate, request.body, reply);
    if (!body) return;
    // Es darf nur eine aktive Fahrt je Nutzer geben; ältere aktive wird automatisch beendet.
    await db
      .update(trips)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(eq(trips.userId, request.userId!), eq(trips.status, 'active')));
    const inserted = await db
      .insert(trips)
      .values({
        userId: request.userId!,
        trainType: body.trainType,
        trainNumber: normalizeTrainNumber(body.trainNumber),
        platform: body.platform,
        clockOffsetMs: body.clockOffsetMs ?? 0,
      })
      .returning();
    reply.code(201).send(toTrip(inserted[0]));
  });

  app.get('/api/trips', { preHandler: app.requireAuth }, async (request, reply) => {
    const rows = await db
      .select({ trip: trips, sampleCount: sql<number>`count(${samples.id})`.as('sample_count') })
      .from(trips)
      .leftJoin(samples, eq(samples.tripId, trips.id))
      .where(eq(trips.userId, request.userId!))
      .groupBy(trips.id)
      .orderBy(desc(trips.startedAt));
    reply.send(rows.map((r) => toTrip(r.trip, Number(r.sampleCount))));
  });

  app.get('/api/trips/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const rows = await db
      .select({ trip: trips, sampleCount: sql<number>`count(${samples.id})`.as('sample_count') })
      .from(trips)
      .leftJoin(samples, eq(samples.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.userId, request.userId!)))
      .groupBy(trips.id);
    const row = rows[0];
    if (!row) {
      sendProblem(reply, 404, 'Fahrt nicht gefunden');
      return;
    }
    reply.send(toTrip(row.trip, Number(row.sampleCount)));
  });

  // Nachträgliche Korrektur (z.B. Zugnummer erst aus dem ICE-Portal bekannt); auch per Bearer-Token nutzbar.
  app.patch('/api/trips/:id', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseOrProblem(TripUpdate, request.body, reply);
    if (!body) return;
    const existing = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, request.userId!)))
      .limit(1);
    if (!existing[0]) {
      sendProblem(reply, 404, 'Fahrt nicht gefunden');
      return;
    }
    const patch: Partial<typeof trips.$inferInsert> = {};
    if (body.trainType !== undefined) patch.trainType = body.trainType;
    if (body.trainNumber !== undefined) patch.trainNumber = normalizeTrainNumber(body.trainNumber);
    const updated = Object.keys(patch).length > 0 ? await db.update(trips).set(patch).where(eq(trips.id, id)).returning() : existing;
    reply.send(toTrip(updated[0]));
  });

  app.get('/api/trips/:id/samples', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id: tripId } = request.params as { id: string };
    const query = parseOrProblem(TripSamplesQuery, request.query, reply);
    if (!query) return;
    const tripRows = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.userId, request.userId!)))
      .limit(1);
    const trip = tripRows[0];
    if (!trip) {
      sendProblem(reply, 404, 'Fahrt nicht gefunden');
      return;
    }

    // `since` filtert über `created_at` statt `ts`: so werden auch verspätet eingetroffene Samples
    // mit älterem (korrigiertem) `ts` beim inkrementellen Nachladen einer laufenden Fahrt erfasst.
    const sampleConditions = query.since
      ? and(eq(samples.tripId, tripId), gt(samples.createdAt, new Date(query.since)))
      : eq(samples.tripId, tripId);
    const sampleRows = await db
      .select()
      .from(samples)
      .where(sampleConditions)
      .orderBy(asc(samples.ts));

    // Zusätzlich zu TripSample (packages/shared) liefern wir iceState/posSource als lose Erweiterung
    // mit aus (das Schema selbst bleibt unverändert, siehe apps/web TripSampleExt).
    const tripSamples: (TripSample & { iceState: string | null; posSource: string | null })[] = sampleRows.map((s) => ({
      id: s.id,
      ts: s.ts.toISOString(),
      kind: s.kind as TripSample['kind'],
      lat: s.lat,
      lon: s.lon,
      accuracyM: s.accuracyM,
      speedMps: s.speedMps,
      n: s.n,
      lost: s.lost,
      rttMedian: s.rttMedian,
      rttP90: s.rttP90,
      jitterMs: s.jitterMs,
      downBps: s.downBps,
      upBps: s.upBps,
      rttLoadedMs: s.rttLoadedMs,
      httpMs: s.httpMs,
      ok: s.ok,
      captive: s.captive,
      asn: s.asn,
      netClass: s.netClass as NetClass,
      flags: s.flags,
      iceState: s.iceState,
      posSource: s.posSource,
    }));

    const asnStats = await db
      .select({
        asn: samples.asn,
        netClass: samples.netClass,
        name: asnCatalog.name,
        samples: sql<number>`count(${samples.id})`.as('n_samples'),
      })
      .from(samples)
      .leftJoin(asnCatalog, eq(asnCatalog.asn, samples.asn))
      .where(and(eq(samples.tripId, tripId), isNotNull(samples.asn)))
      .groupBy(samples.asn, samples.netClass, asnCatalog.name)
      .orderBy(desc(sql`count(${samples.id})`));

    // Bei `since` enthält `sampleRows` nur den neuen Ausschnitt; `trip.sampleCount` soll aber
    // weiterhin die Gesamtzahl der Fahrt zeigen.
    let totalSampleCount = sampleRows.length;
    if (query.since) {
      const countRows = await db
        .select({ n: sql<number>`count(*)`.as('n') })
        .from(samples)
        .where(eq(samples.tripId, tripId));
      totalSampleCount = Number(countRows[0]?.n ?? 0);
    }

    const response: TripSamples = {
      trip: toTrip(trip, totalSampleCount),
      samples: tripSamples,
      asns: asnStats.map((r) => ({
        asn: r.asn as number,
        name: r.name ?? `ASN ${r.asn}`,
        netClass: r.netClass as NetClass,
        samples: Number(r.samples),
      })),
      serverTime: new Date().toISOString(),
    };
    reply.send(response);
  });

  app.post('/api/trips/:id/end', { preHandler: app.requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseOrProblem(TripEnd, request.body ?? {}, reply);
    if (!body) return;
    const existing = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, request.userId!)))
      .limit(1);
    if (!existing[0]) {
      sendProblem(reply, 404, 'Fahrt nicht gefunden');
      return;
    }
    const updated = await db
      .update(trips)
      .set({
        status: 'ended',
        endedAt: new Date(),
        ...(body.clockOffsetMs !== undefined ? { clockOffsetMs: body.clockOffsetMs } : {}),
      })
      .where(eq(trips.id, id))
      .returning();
    reply.send(toTrip(updated[0]));
  });

  // Eigene, auf diesen Plugin-Kontext beschränkte Registrierung: unterstützt zusätzlich
  // gzip-komprimierte JSON-Bodies (Content-Encoding: gzip), verhält sich sonst wie der
  // Standard-JSON-Parser. Encapsulated, damit andere Routen (z.B. /mailpit-Proxy) unberührt bleiben.
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
      try {
        const buf = body as Buffer;
        const raw = request.headers['content-encoding'] === 'gzip' ? gunzipSync(buf) : buf;
        if (raw.length === 0) {
          done(null, undefined);
          return;
        }
        done(null, JSON.parse(raw.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    scoped.post('/api/trips/:id/samples', { preHandler: app.requireAuth }, async (request, reply) => {
      const { id: tripId } = request.params as { id: string };
    const tripRows = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.userId, request.userId!)))
      .limit(1);
    const trip = tripRows[0];
    if (!trip) {
      sendProblem(reply, 404, 'Fahrt nicht gefunden');
      return;
    }

    const raw = request.body as unknown;
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).samples)) {
      sendProblem(reply, 400, 'Ungültiger Request', { detail: 'samples fehlt oder ist kein Array' });
      return;
    }
    const rawSamples = (raw as { samples: unknown[] }).samples;
    if (rawSamples.length === 0) {
      sendProblem(reply, 400, 'samples darf nicht leer sein');
      return;
    }

    // Letzte bekannte Position dieser Fahrt aus der DB, um die implausible_speed-Kette fortzusetzen.
    const prevRows = await db
      .select({ ts: samples.ts, lat: samples.lat, lon: samples.lon })
      .from(samples)
      .where(and(eq(samples.tripId, tripId), isNotNull(samples.lat), isNotNull(samples.lon)))
      .orderBy(desc(samples.ts))
      .limit(1);
    let prevPos: LastPosition | null = prevRows[0]
      ? { ts: prevRows[0].ts.getTime(), lat: prevRows[0].lat as number, lon: prevRows[0].lon as number }
      : null;

    const rowsToInsert: (typeof samples.$inferInsert)[] = [];
    let rejected = 0;
    let maxTs = 0;
    const serverNow = Date.now();

    for (const rawSample of rawSamples) {
      const parsed = Sample.safeParse(rawSample);
      if (!parsed.success) {
        rejected += 1;
        continue;
      }
      const s = parsed.data;
      const correctedTs = s.ts + trip.clockOffsetMs;
      maxTs = Math.max(maxTs, correctedTs);

      const flags: string[] = [];
      if (isOutOfBbox(s.lat, s.lon)) flags.push('out_of_bbox');
      if (isBadAccuracy(s.accuracyM)) flags.push('bad_accuracy');
      if (isClockSkew(correctedTs, serverNow)) flags.push('clock_skew');
      if (s.lat !== null && s.lon !== null) {
        if (isImplausibleSpeed(prevPos, { ts: correctedTs, lat: s.lat, lon: s.lon })) flags.push('implausible_speed');
        prevPos = { ts: correctedTs, lat: s.lat, lon: s.lon };
      }

      let netAsn: number | null = null;
      let netClass: NetClass = 'unknown';
      let ipVersion: 4 | 6 | null = null;
      if (s.net) {
        const ok = verifyNetToken(
          cfg.APP_SECRET,
          { asn: s.net.asn, netClass: s.net.netClass, ipVersion: s.net.ipVersion, exp: s.net.exp },
          s.net.sig,
        );
        if (ok) {
          netAsn = s.net.asn;
          netClass = s.net.netClass;
          ipVersion = s.net.ipVersion;
        } else {
          flags.push('net_sig_invalid');
        }
      }

      const h3R8 = s.lat !== null && s.lon !== null ? latLngToCell(s.lat, s.lon, 8) : null;
      const h3R9 = s.lat !== null && s.lon !== null ? latLngToCell(s.lat, s.lon, 9) : null;

      rowsToInsert.push({
        id: s.id,
        tripId,
        userId: request.userId!,
        ts: new Date(correctedTs),
        kind: s.kind,
        lat: s.lat,
        lon: s.lon,
        accuracyM: s.accuracyM,
        speedMps: s.speedMps,
        heading: s.heading,
        h3R8,
        h3R9,
        asn: netAsn,
        netClass,
        ipVersion,
        connType: s.connType ?? null,
        effectiveType: s.effectiveType ?? null,
        iceState: s.iceState ?? null,
        posSource: s.posSource ?? null,
        flags,
        n: s.kind === 'ping_window' ? s.n : null,
        lost: s.kind === 'ping_window' ? s.lost : null,
        rttMin: s.kind === 'ping_window' ? s.rttMin : null,
        rttMedian: s.kind === 'ping_window' ? s.rttMedian : null,
        rttP90: s.kind === 'ping_window' ? s.rttP90 : null,
        rttMax: s.kind === 'ping_window' ? s.rttMax : null,
        jitterMs: s.kind === 'ping_window' ? s.jitterMs : null,
        downBps: s.kind === 'speedtest' ? s.downBps : null,
        upBps: s.kind === 'speedtest' ? s.upBps : null,
        rttIdleMs: s.kind === 'speedtest' ? s.rttIdleMs : null,
        rttLoadedMs: s.kind === 'speedtest' ? s.rttLoadedMs : null,
        durationMs: s.kind === 'speedtest' ? s.durationMs : null,
        httpMs: s.kind === 'probe' ? s.httpMs : null,
        ok: s.kind === 'probe' ? s.ok : null,
        captive: s.kind === 'probe' ? s.captive : null,
      });
    }

    let accepted = 0;
    if (rowsToInsert.length) {
      const inserted = await db.insert(samples).values(rowsToInsert).onConflictDoNothing().returning({ id: samples.id });
      accepted = inserted.length;
      await db
        .update(trips)
        .set({ lastSampleAt: new Date(maxTs || Date.now()) })
        .where(eq(trips.id, tripId));
    }
    const duplicates = rowsToInsert.length - accepted;
      reply.send({ accepted, duplicates, rejected });
    });
  });
}
