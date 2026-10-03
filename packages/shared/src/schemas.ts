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
});
export type Trip = z.infer<typeof Trip>;

export const TripEnd = z.object({ clockOffsetMs: z.number().int().optional() });

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
});
export type Me = z.infer<typeof Me>;

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
});
export type PublicStats = z.infer<typeof PublicStats>;

/** RFC 9457 Problem Details */
export const Problem = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  errors: z.unknown().optional(),
});
export type Problem = z.infer<typeof Problem>;
