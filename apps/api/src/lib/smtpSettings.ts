import { eq } from 'drizzle-orm';
import type { SmtpSecurity, SmtpSettingsUpdate } from '@bahn/shared';
import { appSettings } from '../db/schema.js';
import type { Db } from '../db/client.js';
import { decryptSecret, encryptSecret } from './secret.js';

const SETTINGS_KEY = 'smtp';

/** So wird der Key "smtp" in `app_settings.value` abgelegt; `passwordEnc` ist nie Klartext. */
export interface StoredSmtpSettings {
  mode: 'env' | 'custom';
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  passwordEnc: string | null;
  from: string;
  rejectUnauthorized: boolean;
}

export async function loadSmtpSettings(db: Db): Promise<StoredSmtpSettings | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.value as StoredSmtpSettings;
}

/**
 * Speichert die SMTP-Einstellungen. `update.password` fehlt => bestehendes verschlüsseltes
 * Passwort beibehalten; leerer String => Passwort löschen; sonst neu verschlüsseln.
 */
export async function saveSmtpSettings(
  db: Db,
  appSecret: string,
  update: SmtpSettingsUpdate,
  updatedBy: string,
): Promise<StoredSmtpSettings> {
  const existing = await loadSmtpSettings(db);
  let passwordEnc: string | null;
  if (update.password === undefined) {
    passwordEnc = existing?.passwordEnc ?? null;
  } else if (update.password === '') {
    passwordEnc = null;
  } else {
    passwordEnc = encryptSecret(appSecret, update.password);
  }

  const value: StoredSmtpSettings = {
    mode: update.mode,
    host: update.host,
    port: update.port,
    security: update.security,
    user: update.user,
    passwordEnc,
    from: update.from,
    rejectUnauthorized: update.rejectUnauthorized,
  };

  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedBy, updatedAt: new Date() },
    });

  return value;
}

export function decryptSmtpPassword(appSecret: string, stored: StoredSmtpSettings): string | undefined {
  if (!stored.passwordEnc) return undefined;
  return decryptSecret(appSecret, stored.passwordEnc);
}

/** Nodemailer-Transport-Optionen für eine Sicherheitsstufe, siehe docs/API.md. */
export function transportOptionsForSecurity(
  security: SmtpSecurity,
  rejectUnauthorized: boolean,
): { secure: boolean; requireTLS?: boolean; ignoreTLS?: boolean; tls: { rejectUnauthorized: boolean } } {
  const tls = { rejectUnauthorized };
  if (security === 'tls') return { secure: true, tls };
  if (security === 'starttls') return { secure: false, requireTLS: true, tls };
  return { secure: false, ignoreTLS: true, tls };
}
