import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { SESSION_TTL_MS } from '@bahn/shared';
import type { Db } from '../db/client.js';
import { apiTokens, sessions } from '../db/schema.js';

const LAST_SEEN_UPDATE_INTERVAL_MS = 10 * 60_000;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface SessionInfo {
  userId: string;
  expiresAt: Date;
}

/** Legt eine neue Session an und gibt das Klartext-Token zurück (wird nur als Cookie verschickt, nie gespeichert). */
export async function createSession(db: Db, userId: string, label: string | null): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ idHash: sha256Hex(token), userId, label, expiresAt });
  return { token, expiresAt };
}

/**
 * Prüft ein Session-Cookie-Token. Bei Erfolg wird die Session gleitend um SESSION_TTL_MS verlängert,
 * aber `lastSeenAt` nur aktualisiert, wenn seit dem letzten Mal mehr als 10 Minuten vergangen sind.
 */
export async function verifySessionToken(db: Db, token: string): Promise<SessionInfo | null> {
  const hash = sha256Hex(token);
  const rows = await db.select().from(sessions).where(eq(sessions.idHash, hash)).limit(1);
  const row = rows[0];
  if (!row) return null;
  const now = new Date();
  if (row.expiresAt.getTime() < now.getTime()) return null;
  if (now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_UPDATE_INTERVAL_MS) {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(sessions).set({ lastSeenAt: now, expiresAt }).where(eq(sessions.idHash, hash));
  }
  return { userId: row.userId, expiresAt: row.expiresAt };
}

export async function deleteSessionByToken(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.idHash, sha256Hex(token)));
}

export async function deleteAllSessionsForUser(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Prüft einen Bearer-API-Token (gegen `api_tokens`, nicht widerrufen). */
export async function verifyApiToken(db: Db, token: string): Promise<{ userId: string } | null> {
  const hash = sha256Hex(token);
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.tokenHash, hash));
  return { userId: row.userId };
}

export function sessionCookieOptions(publicUrl: string, maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: publicUrl.startsWith('https'),
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}
