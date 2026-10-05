import { eq } from 'drizzle-orm';
import type { LegalInfo, LegalInfoUpdate } from '@bahn/shared';
import { appSettings } from '../db/schema.js';
import type { Db } from '../db/client.js';

const SETTINGS_KEY = 'legal';

const EMPTY: LegalInfoUpdate = {
  name: '',
  street: '',
  postalCity: '',
  country: '',
  email: '',
  phone: '',
  contentResponsible: '',
  hoster: '',
  mailProvider: '',
};

/** Anbieterangaben für Impressum/Datenschutz, fehlende Felder als leere Strings. */
export async function loadLegalInfo(db: Db): Promise<LegalInfo> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const row = rows[0];
  if (!row) return { ...EMPTY, updatedAt: null };
  return { ...EMPTY, ...(row.value as Partial<LegalInfoUpdate>), updatedAt: row.updatedAt?.toISOString() ?? null };
}

export async function saveLegalInfo(db: Db, update: LegalInfoUpdate, updatedBy: string): Promise<LegalInfo> {
  const now = new Date();
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: update, updatedBy, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: update, updatedBy, updatedAt: now } });
  return { ...update, updatedAt: now.toISOString() };
}
