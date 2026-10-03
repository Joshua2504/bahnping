import { eq } from 'drizzle-orm';
import type { Config } from '../config.js';
import { adminEmailSet } from '../config.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

/**
 * Setzt die Rolle auf `admin`, wenn die E-Mail in `ADMIN_EMAILS` steht (case-insensitive).
 * Nimmt die Rolle nie wieder weg – ADMIN_EMAILS entfernen reicht nicht, um Admin-Rechte zu
 * ziehen (dafür müsste die Rolle in der DB direkt zurückgesetzt werden).
 */
export async function ensureAdminRole(db: Db, cfg: Config, userId: string, email: string, currentRole: string): Promise<string> {
  if (currentRole === 'admin') return currentRole;
  const admins = adminEmailSet(cfg);
  if (!admins.has(email.toLowerCase())) return currentRole;
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
  return 'admin';
}
