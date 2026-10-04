import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Datenschutz-Grundsatz: In keiner Tabelle gibt es eine Spalte für IP-Adressen oder deren Hashes.
 * Netzinformationen liegen nur als ASN + Klasse + IP-Version vor.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').unique(),
  role: text('role').notNull().default('user'),
  leaderboardOptIn: boolean('leaderboard_opt_in').notNull().default(false),
  /**
   * Laufende Fahrten anonymisiert auf der öffentlichen Live-Karte zeigen, siehe `/account`. Default
   * muss zu `LIVE_PUBLIC_DEFAULT` in `packages/shared/src/constants.ts` passen (dort umschalten,
   * wenn vor dem öffentlichen Start auf Opt-in gewechselt wird; drizzle-kit kann wegen des
   * ESM-`exports`-Felds von `@bahn/shared` hier nicht direkt importieren).
   */
  livePublic: boolean('live_public').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 des Cookie-Tokens, nie das Token selbst */
    idHash: text('id_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** grob: "iOS Safari", "Android Chrome", "Desktop Firefox" – kein voller User-Agent */
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const magicLinks = pgTable('magic_links', {
  tokenHash: text('token_hash').primaryKey(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
});

export const apiTokens = pgTable('api_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trainType: text('train_type').notNull(),
    trainNumber: text('train_number'),
    platform: text('platform').notNull(),
    clockOffsetMs: integer('clock_offset_ms').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastSampleAt: timestamp('last_sample_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
  },
  (t) => [index('trips_user_idx').on(t.userId, t.startedAt)],
);

/**
 * Messwerte. Eine Zeile je 10-s-Ping-Fenster, Speedtest oder Probe.
 * Für die Testversion unpartitioniert; in Produktion monatlich nach ts partitionieren.
 */
export const samples = pgTable(
  'samples',
  {
    id: uuid('id').primaryKey(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** korrigierte Zeit (Client-ts + clockOffsetMs) */
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    kind: text('kind').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    accuracyM: doublePrecision('accuracy_m'),
    speedMps: doublePrecision('speed_mps'),
    heading: doublePrecision('heading'),
    h3R8: text('h3_r8'),
    h3R9: text('h3_r9'),
    // ping_window
    n: integer('n'),
    lost: integer('lost'),
    rttMin: doublePrecision('rtt_min'),
    rttMedian: doublePrecision('rtt_median'),
    rttP90: doublePrecision('rtt_p90'),
    rttMax: doublePrecision('rtt_max'),
    jitterMs: doublePrecision('jitter_ms'),
    // speedtest
    downBps: doublePrecision('down_bps'),
    upBps: doublePrecision('up_bps'),
    rttIdleMs: doublePrecision('rtt_idle_ms'),
    rttLoadedMs: doublePrecision('rtt_loaded_ms'),
    durationMs: integer('duration_ms'),
    // probe
    httpMs: doublePrecision('http_ms'),
    ok: boolean('ok'),
    captive: boolean('captive'),
    // Netz (nur ASN/Klasse/Version – niemals IP)
    asn: integer('asn'),
    netClass: text('net_class').notNull().default('unknown'),
    ipVersion: smallint('ip_version'),
    connType: text('conn_type'),
    effectiveType: text('effective_type'),
    /** Konnektivitätsstatus laut ICE-Portal (HIGH, MIDDLE, LOW, UNSTABLE, NO_INFO), nur App/CLI */
    iceState: text('ice_state'),
    /** Positionsquelle: gps, iceportal, none */
    posSource: text('pos_source'),
    /** z.B. off_rail, implausible_speed, bad_accuracy, out_of_bbox, net_sig_invalid */
    flags: text('flags').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('samples_trip_ts_idx').on(t.tripId, t.ts),
    index('samples_ts_idx').on(t.ts),
    index('samples_h3r8_idx').on(t.h3R8),
    index('samples_h3r9_idx').on(t.h3R9),
    index('samples_user_idx').on(t.userId),
  ],
);

/**
 * Allgemeine Admin-Einstellungen als Key/Value mit JSON-Wert, z.B. SMTP-Zugangsdaten (Key "smtp").
 * Geheimnisse (z.B. Passwörter) liegen im `value`-JSON verschlüsselt, nie im Klartext.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export const asnCatalog = pgTable('asn_catalog', {
  asn: integer('asn').primaryKey(),
  name: text('name').notNull(),
  netClass: text('net_class').notNull().default('unknown'),
  source: text('source').notNull().default('seed'),
  /** Anzahl Sichtungen über whoami, hilft bei der Review unbekannter ASNs */
  seen: integer('seen').notNull().default(0),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
