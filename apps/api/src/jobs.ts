import type { FastifyBaseLogger } from 'fastify';
import { and, eq, lt, sql } from 'drizzle-orm';
import { TRIP_IDLE_END_MS } from '@bahn/shared';
import type { Db } from './db/client.js';
import { magicLinks, sessions, trips } from './db/schema.js';

const JOB_INTERVAL_MS = 5 * 60_000;

/** Aktive Fahrten ohne neue Samples seit TRIP_IDLE_END_MS automatisch beenden (z.B. App beendet, Akku leer). */
async function endIdleTrips(db: Db, log: FastifyBaseLogger): Promise<void> {
  const cutoff = new Date(Date.now() - TRIP_IDLE_END_MS);
  const lastActivity = sql`coalesce(${trips.lastSampleAt}, ${trips.startedAt})`;
  const rows = await db
    .update(trips)
    .set({ status: 'ended', endedAt: lastActivity })
    .where(and(eq(trips.status, 'active'), lt(lastActivity, cutoff)))
    .returning({ id: trips.id });
  if (rows.length > 0) log.info({ count: rows.length }, 'inaktive Fahrten automatisch beendet');
}

/** Abgelaufene Sessions und nicht mehr gültige Magic Links aus der DB entfernen. */
async function cleanupExpired(db: Db, log: FastifyBaseLogger): Promise<void> {
  const now = new Date();
  const sessionRows = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.idHash });
  const magicRows = await db.delete(magicLinks).where(lt(magicLinks.expiresAt, now)).returning({ id: magicLinks.tokenHash });
  if (sessionRows.length > 0 || magicRows.length > 0) {
    log.info({ sessions: sessionRows.length, magicLinks: magicRows.length }, 'abgelaufene Sessions/Magic-Links aufgeräumt');
  }
}

/**
 * Startet die serverseitigen Wartungsjobs (alle 5 min, einmal sofort beim Start). Gibt den Timer
 * zurück; er ist `unref()`t, damit er den Prozess nicht am Beenden hindert.
 */
export function startJobs(db: Db, log: FastifyBaseLogger): NodeJS.Timeout {
  const run = (): void => {
    endIdleTrips(db, log).catch((err) => log.warn({ err: String(err) }, 'Job „inaktive Fahrten beenden“ fehlgeschlagen'));
    cleanupExpired(db, log).catch((err) => log.warn({ err: String(err) }, 'Job „Aufräumen“ fehlgeschlagen'));
  };
  run();
  const interval = setInterval(run, JOB_INTERVAL_MS);
  interval.unref();
  return interval;
}
