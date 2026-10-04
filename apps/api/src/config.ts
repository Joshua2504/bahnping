import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4100),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().url().default('http://localhost:4100'),
  DATABASE_URL: z.string().min(1),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(4125),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('BahnPing <noreply@bahn-tracker.local>'),
  MAILPIT_UPSTREAM: z.string().optional(),
  APP_SECRET: z.string().min(32),
  /**
   * "false" = X-Forwarded-For ignorieren, "true" = jedem Proxy vertrauen (nur wenn die API nicht direkt
   * erreichbar ist), sonst kommagetrennte IPs/CIDRs der vertrauenswürdigen Proxys, z.B. "172.20.0.1".
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v): boolean | string => {
      const t = v.trim();
      if (t === '' || t === 'false' || t === '0') return false;
      if (t === 'true' || t === '1') return true;
      return t;
    }),
  PUBLIC_MIN_TRIPS: z.coerce.number().int().min(1).default(3),
  IPTOASN_URL: z.string().optional(),
  IPTOASN_CACHE: z.string().default('.run/ip2asn-combined.tsv.gz'),
  NETCLASS_OVERRIDES: z.string().default(''),
  WEB_DIST: z.string().optional(),
  TILES_DIR: z.string().optional(),
  /** Verzeichnis mit den CLI-Binaries, ausgeliefert unter `/dl/<dateiname>`, relativ zu apps/api. */
  DOWNLOADS_DIR: z.string().default('../../.run/dist'),
  /** Kommagetrennte E-Mail-Adressen, die beim Login/`/api/me` automatisch Admin-Rolle erhalten. */
  ADMIN_EMAILS: z.string().default(''),
});

export type Config = z.infer<typeof Env>;

/** Normalisierte, lowercase Admin-E-Mail-Liste aus `ADMIN_EMAILS`. */
export function adminEmailSet(cfg: Config): Set<string> {
  return new Set(
    cfg.ADMIN_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    // Absichtlich keine Env-Werte ausgeben (Secrets).
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Ungültige Konfiguration, betroffene Variablen: ${fields}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && cfg.APP_SECRET.startsWith('dev-only')) {
    throw new Error('APP_SECRET muss in Produktion gesetzt werden');
  }
  return cfg;
}
