import { z } from 'zod';
import { NetClass, TrainType } from './netclass.js';

// ---------- Netz / whoami ----------

/** Vom Server signierte Netzklassifizierung; der Client hängt sie an seine Samples. */
export const NetToken = z.object({
  asn: z.number().int().nonnegative(),
  netClass: NetClass,
  ipVersion: z.union([z.literal(4), z.literal(6)]).nullable(),
  /** Ablauf als Epoch-ms */
  exp: z.number().int(),
  /** HMAC über asn|netClass|ipVersion|exp, base64url */
  sig: z.string().min(16).max(128),
});
export type NetToken = z.infer<typeof NetToken>;

export const WhoamiResponse = NetToken.extend({
  asName: z.string(),
  label: z.string(),
});
export type WhoamiResponse = z.infer<typeof WhoamiResponse>;

// ---------- Samples ----------

const SampleBase = z.object({
  /** Client-generierte UUID, macht Uploads idempotent. */
  id: z.uuid(),
  /** Client-Zeit in Epoch-ms (Server korrigiert um clockOffsetMs der Fahrt). */
  ts: z.number().int(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  accuracyM: z.number().nonnegative().nullable(),
  speedMps: z.number().nonnegative().nullable(),
  heading: z.number().min(0).max(360).nullable(),
  net: NetToken.nullable(),
  /** navigator.connection.type, nur Chromium */
  connType: z.string().max(20).nullable().optional(),
  /** navigator.connection.effectiveType, nur Chromium */
  effectiveType: z.string().max(10).nullable().optional(),
  /** Konnektivitätsstatus laut ICE-Portal (HIGH, MIDDLE, LOW, UNSTABLE, NO_INFO), nur App/CLI */
  iceState: z.string().max(20).nullable().optional(),
  /** Vom ICE-Portal vorhergesagter nächster Status (connectivity.nextState) und Sekunden bis dahin. */
  iceNextState: z.string().max(20).nullable().optional(),
  iceRemainingS: z.number().int().min(0).max(86_400).nullable().optional(),
  /** Separater Internet-Indikator des Portals (z.B. HIGH, OFFLINE), nicht identisch mit iceState. */
  iceInternet: z.string().max(20).nullable().optional(),
  /** Positionsquelle: gps (Gerät), iceportal, none */
  posSource: z.enum(['gps', 'iceportal', 'none']).optional(),
});

export const PingWindowSample = SampleBase.extend({
  kind: z.literal('ping_window'),
  n: z.number().int().min(1).max(100),
  lost: z.number().int().min(0).max(100),
  rttMin: z.number().nonnegative().nullable(),
  rttMedian: z.number().nonnegative().nullable(),
  rttP90: z.number().nonnegative().nullable(),
  rttMax: z.number().nonnegative().nullable(),
  jitterMs: z.number().nonnegative().nullable(),
});

export const SpeedtestSample = SampleBase.extend({
  kind: z.literal('speedtest'),
  downBps: z.number().nonnegative().nullable(),
  upBps: z.number().nonnegative().nullable(),
  rttIdleMs: z.number().nonnegative().nullable(),
  rttLoadedMs: z.number().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative(),
});

export const ProbeSample = SampleBase.extend({
  kind: z.literal('probe'),
  httpMs: z.number().nonnegative().nullable(),
  ok: z.boolean(),
  captive: z.boolean(),
});

export const Sample = z.discriminatedUnion('kind', [PingWindowSample, SpeedtestSample, ProbeSample]);
export type Sample = z.infer<typeof Sample>;
export type PingWindowSample = z.infer<typeof PingWindowSample>;
export type SpeedtestSample = z.infer<typeof SpeedtestSample>;
export type ProbeSample = z.infer<typeof ProbeSample>;

export const SampleBatch = z.object({ samples: z.array(Sample).min(1).max(500) });
export type SampleBatch = z.infer<typeof SampleBatch>;
export const SampleBatchResponse = z.object({ accepted: z.number().int(), duplicates: z.number().int(), rejected: z.number().int() });

// ---------- Fahrten ----------

export const TripCreate = z.object({
  trainType: TrainType,
  trainNumber: z.string().trim().max(20).optional(),
  /** grobe Plattformangabe, z.B. "android-pwa", "ios-safari", "desktop-chrome" */
  platform: z.string().max(40),
  clockOffsetMs: z.number().int().min(-86_400_000).max(86_400_000).optional(),
});
export type TripCreate = z.infer<typeof TripCreate>;

export const Trip = z.object({
  id: z.uuid(),
  trainType: TrainType,
  trainNumber: z.string().nullable(),
  platform: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  status: z.enum(['active', 'ended', 'flagged']),
  sampleCount: z.number().int().optional(),
  /** Triebzugnummer laut ICE-Portal (physische Einheit, z.B. "ICE9012"); nur CLI. */
  iceTzn: z.string().nullable().optional(),
  /** Baureihe laut ICE-Portal (z.B. "412" = ICE 4). */
  iceSeries: z.string().nullable().optional(),
  /** Fahrplantag (YYYY-MM-DD), Start- und Zielbahnhof laut ICE-Portal. */
  tripDate: z.string().nullable().optional(),
  originName: z.string().nullable().optional(),
  destinationName: z.string().nullable().optional(),
});
export type Trip = z.infer<typeof Trip>;

export const TripEnd = z.object({ clockOffsetMs: z.number().int().optional() });

/** Nachträgliche Korrektur, z.B. wenn die CLI die Zugnummer erst aus dem ICE-Portal erfährt. */
export const TripUpdate = z.object({
  trainType: TrainType.optional(),
  trainNumber: z.string().trim().max(20).nullable().optional(),
  iceTzn: z.string().trim().max(20).nullable().optional(),
  iceSeries: z.string().trim().max(10).nullable().optional(),
  tripDate: z.string().trim().max(10).nullable().optional(),
  originName: z.string().trim().max(120).nullable().optional(),
  destinationName: z.string().trim().max(120).nullable().optional(),
});
export type TripUpdate = z.infer<typeof TripUpdate>;

/**
 * Ein Halt laut ICE-Portal-Fahrplan. Die CLI sendet die komplette Liste per
 * `PUT /api/trips/:id/stops` (ersetzt den vorherigen Stand), sobald sich etwas ändert.
 * Zeiten als ISO-8601.
 */
export const TripStop = z.object({
  seq: z.number().int().min(0).max(200),
  evaNr: z.string().max(20).nullable(),
  name: z.string().min(1).max(120),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  scheduledArrival: z.string().nullable(),
  actualArrival: z.string().nullable(),
  scheduledDeparture: z.string().nullable(),
  actualDeparture: z.string().nullable(),
  trackScheduled: z.string().max(10).nullable(),
  trackActual: z.string().max(10).nullable(),
  passed: z.boolean().nullable(),
  /** z.B. departed, future, passed (Freitext des Portals) */
  positionStatus: z.string().max(20).nullable(),
});
export type TripStop = z.infer<typeof TripStop>;
export const TripStopsPut = z.object({ stops: z.array(TripStop).max(200) });
export type TripStopsPut = z.infer<typeof TripStopsPut>;

// ---------- Auth / Konto ----------

export const MagicLinkRequest = z.object({
  email: z.email().max(254),
  altcha: z.string().min(10).max(4000),
});
export const ConfirmRequest = z.object({ token: z.string().min(20).max(200) });
export const MeUpdate = z.object({
  displayName: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u, 'Nur Buchstaben, Zahlen, Leerzeichen, . _ -'),
  altcha: z.string().min(10).max(4000),
});
export const Me = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(['user', 'admin']),
  createdAt: z.string(),
  /** Laufende Fahrten anonymisiert auf der öffentlichen Live-Karte zeigen, siehe `/account`. */
  livePublic: z.boolean(),
});
export type Me = z.infer<typeof Me>;

/** `PATCH /api/me/settings`: bisher nur `livePublic`, kein ALTCHA nötig (keine Enumeration/Spam-Gefahr). */
export const MeSettingsUpdate = z.object({ livePublic: z.boolean() });
export type MeSettingsUpdate = z.infer<typeof MeSettingsUpdate>;

// ---------- API-Tokens (CLI/App) ----------

export const ApiTokenCreate = z.object({
  name: z.string().trim().min(1).max(60),
  altcha: z.string().min(10).max(4000),
});
export const ApiTokenInfo = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type ApiTokenInfo = z.infer<typeof ApiTokenInfo>;
/** Das Token selbst wird genau einmal, direkt nach dem Anlegen, ausgegeben. */
export const ApiTokenCreated = ApiTokenInfo.extend({ token: z.string() });
export type ApiTokenCreated = z.infer<typeof ApiTokenCreated>;

// ---------- WebSocket ----------

export const WsServerMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), serverTime: z.number().int() }),
  /** Server-getriebener Ping; Client antwortet sofort mit pong (gleiche seq). */
  z.object({ t: z.literal('ping'), seq: z.number().int() }),
  /** Antwort auf sync: t1 = Empfang beim Server, t2 = Senden beim Server */
  z.object({ t: z.literal('sync'), cid: z.number().int(), t0: z.number().int(), t1: z.number().int(), t2: z.number().int() }),
  /** Server teilt gemessene RTT mit, damit der Client nicht selbst messen muss. */
  z.object({ t: z.literal('rtt'), seq: z.number().int(), rttMs: z.number() }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

export const WsClientMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('pong'), seq: z.number().int() }),
  z.object({ t: z.literal('sync'), cid: z.number().int(), t0: z.number().int() }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

// ---------- Öffentliche Auswertung ----------

export const METRICS = ['rtt', 'loss', 'avail', 'down', 'up'] as const;
export const Metric = z.enum(METRICS);
export type Metric = z.infer<typeof Metric>;
export const PERIODS = ['7d', '30d', '365d', 'all'] as const;
export const Period = z.enum(PERIODS);

export const CellsQuery = z.object({
  res: z.coerce.number().int().min(6).max(9).default(8),
  /** "west,south,east,north" */
  bbox: z.string().regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/),
  net: z.union([NetClass, z.literal('all')]).default('all'),
  period: Period.default('30d'),
  train: z.union([TrainType, z.literal('all')]).default('all'),
  /** nur eigene Fahrten (eingeloggt), ignoriert PUBLIC_MIN_TRIPS */
  mine: z.coerce.boolean().default(false),
});
export type CellsQuery = z.infer<typeof CellsQuery>;

/** [h3, nSamples, nTrips, rttMedian, lossPct, availPct, downMedianBps, upMedianBps] */
export const CellRow = z.tuple([
  z.string(),
  z.number().int(),
  z.number().int(),
  z.number().nullable(),
  z.number().nullable(),
  z.number().nullable(),
  z.number().nullable(),
  z.number().nullable(),
]);
export type CellRow = z.infer<typeof CellRow>;
export const CellsResponse = z.object({ res: z.number().int(), minTrips: z.number().int(), cells: z.array(CellRow) });
export type CellsResponse = z.infer<typeof CellsResponse>;

// ---------- Öffentliche Live-Karte ----------

/** RTT/Verlust je Netzklasse, zusammengefasst über die letzten `LIVE_NET_WINDOW_MS` je Live-Zug. */
export const LiveTrainNet = z.object({
  netClass: NetClass,
  rttMedian: z.number().nullable(),
  lossPct: z.number().nullable(),
});
export type LiveTrainNet = z.infer<typeof LiveTrainNet>;

/**
 * Ein (ggf. aus mehreren Trackern zusammengefasster) Live-Zug auf `/api/public/live`. Enthält
 * absichtlich keine Nutzer-ID, keinen Namen und keine Fahrt-ID – `key` ist ein HMAC-Kürzel, über
 * das Positionen derselben Zugnummer zwischen zwei Abrufen stabil zuordenbar sind.
 */
export const LiveTrain = z.object({
  key: z.string().max(12),
  label: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  speedKmh: z.number().nullable(),
  /** Anzahl Fahrten (Tracker), die zu diesem Eintrag zusammengefasst wurden. */
  trackers: z.number().int().min(1),
  nets: z.array(LiveTrainNet),
  /** Alter des letzten Positions-Samples in Sekunden, gerundet auf 10s. */
  lastSeenSec: z.number().int().nonnegative(),
  iceState: z.string().nullable(),
  /** Nächster Halt und Verspätung dort (Minuten) laut ICE-Portal, falls bekannt. */
  nextStop: z.string().nullable().optional(),
  delayMin: z.number().int().nullable().optional(),
});
export type LiveTrain = z.infer<typeof LiveTrain>;

export const PublicLive = z.object({
  /** Alle aktiven Fahrten, unabhängig von `livePublic` oder Position (siehe docs/API.md). */
  activeTrips: z.number().int(),
  trains: z.array(LiveTrain),
  generatedAt: z.string(),
});
export type PublicLive = z.infer<typeof PublicLive>;

export const PublicStats = z.object({
  totals: z.object({ trips: z.number().int(), samples: z.number().int(), users: z.number().int(), activeTrips: z.number().int() }),
  byNet: z.array(
    z.object({
      netClass: NetClass,
      nSamples: z.number().int(),
      nTrips: z.number().int(),
      rttMedian: z.number().nullable(),
      rttP90: z.number().nullable(),
      lossPct: z.number().nullable(),
      downMedianBps: z.number().nullable(),
      upMedianBps: z.number().nullable(),
    }),
  ),
  /** Prognose des ICE-Bordportals (iceState) gegen die tatsächlich gemessene Verbindung (ping_window). */
  byIceState: z.array(
    z.object({
      iceState: z.string(),
      nSamples: z.number().int(),
      nTrips: z.number().int(),
      availPct: z.number().nullable(),
      lossPct: z.number().nullable(),
      rttMedian: z.number().nullable(),
    }),
  ),
});
export type PublicStats = z.infer<typeof PublicStats>;

// ---------- Admin ----------

export const AdminAsn = z.object({
  asn: z.number().int(),
  name: z.string(),
  netClass: NetClass,
  source: z.string(),
  seen: z.number().int(),
  reviewedAt: z.string().nullable(),
  samples: z.number().int(),
  trips: z.number().int(),
});
export type AdminAsn = z.infer<typeof AdminAsn>;

// ---------- Admin: SMTP-Einstellungen ----------

export const SMTP_SECURITY = ['none', 'starttls', 'tls'] as const;
export const SmtpSecurity = z.enum(SMTP_SECURITY);
export type SmtpSecurity = z.infer<typeof SmtpSecurity>;

const hostnameOrIp = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9.:_-]+$/, 'Ungültiger Hostname/IP');

/** "Name <mail@domain>" oder reine Adresse. */
const fromAddress = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .refine((v) => {
    const m = /^(.*)<([^<>]+)>$/.exec(v);
    const addr = m ? m[2].trim() : v;
    return z.email().safeParse(addr).success;
  }, 'Ungültiger Absender, erwartet "mail@domain" oder "Name <mail@domain>"');

export const SmtpSettings = z.object({
  mode: z.enum(['env', 'custom']),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  security: SmtpSecurity,
  user: z.string(),
  from: z.string(),
  rejectUnauthorized: z.boolean(),
  passwordSet: z.boolean(),
  envDefaults: z.object({ host: z.string(), port: z.number().int(), from: z.string() }),
});
export type SmtpSettings = z.infer<typeof SmtpSettings>;

export const SmtpSettingsUpdate = z.object({
  mode: z.enum(['env', 'custom']),
  host: hostnameOrIp,
  port: z.number().int().min(1).max(65535),
  security: SmtpSecurity,
  user: z.string().trim().max(200),
  /** fehlt = bestehendes Passwort beibehalten, "" = Passwort löschen */
  password: z.string().max(500).optional(),
  from: fromAddress,
  rejectUnauthorized: z.boolean(),
});
export type SmtpSettingsUpdate = z.infer<typeof SmtpSettingsUpdate>;

export const SmtpTestRequest = z.object({ to: z.email().max(254).optional() });
export type SmtpTestRequest = z.infer<typeof SmtpTestRequest>;
export const SmtpTestResponse = z.object({ ok: z.literal(true), messageId: z.string() });
export type SmtpTestResponse = z.infer<typeof SmtpTestResponse>;

export const AdminAsnUpdate = z.object({ netClass: NetClass });
export type AdminAsnUpdate = z.infer<typeof AdminAsnUpdate>;
export const AdminAsnUpdateResponse = z.object({ asn: AdminAsn, samplesUpdated: z.number().int() });
export type AdminAsnUpdateResponse = z.infer<typeof AdminAsnUpdateResponse>;

// ---------- Fahrtdetail ----------

export const TripSample = z.object({
  id: z.uuid(),
  ts: z.string(),
  kind: z.enum(['ping_window', 'speedtest', 'probe']),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  accuracyM: z.number().nullable(),
  speedMps: z.number().nullable(),
  n: z.number().int().nullable(),
  lost: z.number().int().nullable(),
  rttMedian: z.number().nullable(),
  rttP90: z.number().nullable(),
  jitterMs: z.number().nullable(),
  downBps: z.number().nullable(),
  upBps: z.number().nullable(),
  rttLoadedMs: z.number().nullable(),
  httpMs: z.number().nullable(),
  ok: z.boolean().nullable(),
  captive: z.boolean().nullable(),
  asn: z.number().int().nullable(),
  netClass: NetClass,
  iceState: z.string().nullable().optional(),
  iceNextState: z.string().nullable().optional(),
  iceRemainingS: z.number().int().nullable().optional(),
  iceInternet: z.string().nullable().optional(),
  posSource: z.string().nullable().optional(),
  flags: z.array(z.string()),
});
export type TripSample = z.infer<typeof TripSample>;

export const TripSamplesAsn = z.object({
  asn: z.number().int(),
  name: z.string(),
  netClass: NetClass,
  samples: z.number().int(),
});
export type TripSamplesAsn = z.infer<typeof TripSamplesAsn>;

export const TripSamples = z.object({
  trip: Trip,
  samples: z.array(TripSample),
  asns: z.array(TripSamplesAsn),
  /** Halte laut ICE-Portal (nur bei CLI-Fahrten befüllt), nach `seq` sortiert. */
  stops: z.array(TripStop).optional(),
  /** Serverzeit (ISO) beim Erstellen der Antwort, als Basis für den nächsten `?since=`-Request. */
  serverTime: z.string(),
});
export type TripSamples = z.infer<typeof TripSamples>;

/** Query für `GET /api/trips/:id/samples`: inkrementelles Nachladen für laufende Fahrten. */
export const TripSamplesQuery = z.object({ since: z.iso.datetime({ offset: true }).optional() });
export type TripSamplesQuery = z.infer<typeof TripSamplesQuery>;

/** RFC 9457 Problem Details */
export const Problem = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.unknown().optional(),
});
export type Problem = z.infer<typeof Problem>;
