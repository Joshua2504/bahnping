import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createMailer } from './lib/mail.js';
import { AsnService } from './lib/asn.js';
import { buildApp } from './app.js';
import { SPEEDTEST_BUFFER_SIZE, type AppContext } from './context.js';

const ONE_HOUR_MS = 60 * 60_000;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { client, db } = createDb(cfg.DATABASE_URL);

  const apiRoot = path.resolve(import.meta.dirname, '..');
  await migrate(db, { migrationsFolder: path.join(apiRoot, 'drizzle') });

  const asn = new AsnService();
  await asn.seedClassMap(db, cfg.NETCLASS_OVERRIDES);

  const mailer = createMailer(cfg);
  const speedBuffer = randomBytes(SPEEDTEST_BUFFER_SIZE);

  const ctx: AppContext = { cfg, db, dbClient: client, mailer, asn, speedBuffer };
  const app = await buildApp(ctx);

  const cachePath = path.resolve(apiRoot, cfg.IPTOASN_CACHE);
  await asn.loadRanges(cfg.IPTOASN_URL, cachePath, app.log);
  const reloadInterval = setInterval(() => {
    asn.loadRanges(cfg.IPTOASN_URL, cachePath, app.log).catch((err) => app.log.warn({ err: String(err) }, 'ASN-Reload fehlgeschlagen'));
  }, ONE_HOUR_MS);
  reloadInterval.unref();

  await app.listen({ port: cfg.PORT, host: cfg.HOST });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Start fehlgeschlagen:', err);
  process.exit(1);
});
