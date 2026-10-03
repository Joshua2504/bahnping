import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

/** Erzeugt Postgres-Client + Drizzle-Instanz. Eine Instanz pro Prozess (bzw. pro Test). */
export function createDb(databaseUrl: string) {
  // Unterdrückt Postgres-NOTICE-Ausgaben (z.B. beim Migrieren: "relation already exists, skipping").
  const client = postgres(databaseUrl, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { client, db };
}

export type Db = ReturnType<typeof createDb>['db'];
