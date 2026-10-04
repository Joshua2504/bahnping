import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { CellsQuery, ICE_STATE_ORDER, LIVE_CACHE_MS, LIVE_NET_WINDOW_MS, LIVE_POSITION_MAX_AGE_MS, type CellRow, type NetClass, type PublicLive, type TrainType } from '@bahn/shared';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';
import { deriveKey } from '../lib/hmac.js';
import { summarizeLiveTrains, type LiveTripRow } from '../lib/liveTrains.js';

const EXCLUDED_FLAGS = ['out_of_bbox', 'bad_accuracy', 'implausible_speed', 'net_sig_invalid'];
const PERIOD_INTERVAL: Record<string, string> = { '7d': '7 days', '30d': '30 days', '365d': '365 days' };

export function registerPublicRoutes(app: FastifyInstance): void {
  const { dbClient, cfg } = app.ctx;

  app.get('/api/public/cells', async (request, reply) => {
    const query = parseOrProblem(CellsQuery, request.query, reply);
    if (!query) return;
    if (query.mine && !request.userId) {
      sendProblem(reply, 401, 'Nicht angemeldet', { detail: 'mine=true erfordert Anmeldung' });
      return;
    }
    const [west, south, east, north] = query.bbox.split(',').map(Number);

    // Für res < 9 liefern wir bewusst die gröberen r8-Zellen aus (siehe docs/API.md); eine
    // echte Aggregation auf r6/r7 per cellToParent ist für die Testversion nicht nötig.
    const useR9 = query.res >= 9;
    const actualRes = useR9 ? 9 : 8;
    const resCol = useR9 ? dbClient`s.h3_r9` : dbClient`s.h3_r8`;

    const conditions = [
      dbClient`s.lat BETWEEN ${south} AND ${north}`,
      dbClient`s.lon BETWEEN ${west} AND ${east}`,
      dbClient`NOT (s.flags && ${dbClient.array(EXCLUDED_FLAGS)})`,
      dbClient`${resCol} IS NOT NULL`,
    ];
    if (query.net !== 'all') conditions.push(dbClient`s.net_class = ${query.net}`);
    if (query.period !== 'all') {
      conditions.push(dbClient`s.ts >= now() - ${PERIOD_INTERVAL[query.period]}::interval`);
    }
    if (query.mine) {
      conditions.push(dbClient`s.user_id = ${request.userId as string}`);
    }
    let joinClause = dbClient``;
    if (query.train !== 'all') {
      joinClause = dbClient`JOIN trips t ON t.id = s.trip_id AND t.train_type = ${query.train}`;
    }
    let whereSql = conditions[0];
    for (let i = 1; i < conditions.length; i += 1) {
      whereSql = dbClient`${whereSql} AND ${conditions[i]}`;
    }
    const havingSql = query.mine ? dbClient`` : dbClient`HAVING count(DISTINCT agg.trip_id) >= ${cfg.PUBLIC_MIN_TRIPS}`;

    const rows = await dbClient<
      { h3: string; n_samples: number; n_trips: number; rtt_median: number | null; loss_pct: number | null; avail_pct: number | null; down_median: number | null; up_median: number | null }[]
    >`
      SELECT
        agg.h3 AS h3,
        count(*)::int AS n_samples,
        count(DISTINCT agg.trip_id)::int AS n_trips,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY agg.rtt_median)
          FILTER (WHERE agg.kind = 'ping_window' AND agg.rtt_median IS NOT NULL) AS rtt_median,
        (100.0 * sum(agg.lost) FILTER (WHERE agg.kind = 'ping_window')
          / NULLIF(sum(agg.n) FILTER (WHERE agg.kind = 'ping_window'), 0))::float8 AS loss_pct,
        (100.0 * count(*) FILTER (WHERE agg.kind = 'ping_window' AND agg.n IS NOT NULL AND agg.lost IS NOT NULL AND agg.n > agg.lost)
          / NULLIF(count(*) FILTER (WHERE agg.kind = 'ping_window' AND agg.n IS NOT NULL AND agg.lost IS NOT NULL), 0))::float8 AS avail_pct,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY agg.down_bps)
          FILTER (WHERE agg.kind = 'speedtest' AND agg.down_bps IS NOT NULL) AS down_median,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY agg.up_bps)
          FILTER (WHERE agg.kind = 'speedtest' AND agg.up_bps IS NOT NULL) AS up_median
      FROM (
        SELECT s.*, ${resCol} AS h3
        FROM samples s
        ${joinClause}
        WHERE ${whereSql}
      ) agg
      GROUP BY agg.h3
      ${havingSql}
    `;

    const cells: CellRow[] = rows.map((r) => [
      r.h3,
      r.n_samples,
      r.n_trips,
      r.rtt_median,
      r.loss_pct,
      r.avail_pct,
      r.down_median,
      r.up_median,
    ]);
    reply.header('cache-control', 'public, max-age=60').send({ res: actualRes, minTrips: cfg.PUBLIC_MIN_TRIPS, cells });
  });

  app.get('/api/public/stats', async (_request, reply) => {
    const totalsRows = await dbClient<{ trips: number; samples: number; users: number; active_trips: number }[]>`
      SELECT
        (SELECT count(*)::int FROM trips) AS trips,
        (SELECT count(*)::int FROM samples) AS samples,
        (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
        (SELECT count(*)::int FROM trips WHERE last_sample_at >= now() - interval '5 minutes') AS active_trips
    `;
    const byNetRows = await dbClient<
      { net_class: string; n_samples: number; n_trips: number; rtt_median: number | null; rtt_p90: number | null; loss_pct: number | null; down_median: number | null; up_median: number | null }[]
    >`
      SELECT
        net_class,
        count(*)::int AS n_samples,
        count(DISTINCT trip_id)::int AS n_trips,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_median) FILTER (WHERE kind = 'ping_window' AND rtt_median IS NOT NULL) AS rtt_median,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY rtt_median) FILTER (WHERE kind = 'ping_window' AND rtt_median IS NOT NULL) AS rtt_p90,
        (100.0 * sum(lost) FILTER (WHERE kind = 'ping_window') / NULLIF(sum(n) FILTER (WHERE kind = 'ping_window'), 0))::float8 AS loss_pct,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY down_bps) FILTER (WHERE kind = 'speedtest' AND down_bps IS NOT NULL) AS down_median,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY up_bps) FILTER (WHERE kind = 'speedtest' AND up_bps IS NOT NULL) AS up_median
      FROM samples
      WHERE NOT (flags && ${dbClient.array(EXCLUDED_FLAGS)})
      GROUP BY net_class
    `;
    // Prognose des Bordportals gegen Messung: nur ping_window-Samples mit bekanntem iceState.
    // Verfügbarkeit wie bei /cells: Anteil der Fenster mit mindestens einer Antwort.
    const byIceRows = await dbClient<
      { ice_state: string; n_samples: number; n_trips: number; avail_pct: number | null; loss_pct: number | null; rtt_median: number | null }[]
    >`
      SELECT
        upper(ice_state) AS ice_state,
        count(*)::int AS n_samples,
        count(DISTINCT trip_id)::int AS n_trips,
        (100.0 * count(*) FILTER (WHERE n > lost) / NULLIF(count(*), 0))::float8 AS avail_pct,
        (100.0 * sum(lost) / NULLIF(sum(n), 0))::float8 AS loss_pct,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY rtt_median) FILTER (WHERE rtt_median IS NOT NULL) AS rtt_median
      FROM samples
      WHERE kind = 'ping_window' AND ice_state IS NOT NULL AND n IS NOT NULL AND lost IS NOT NULL
        AND NOT (flags && ${dbClient.array(EXCLUDED_FLAGS)})
      GROUP BY upper(ice_state)
    `;
    const iceOrder = (state: string) => {
      const i = (ICE_STATE_ORDER as readonly string[]).indexOf(state);
      return i === -1 ? ICE_STATE_ORDER.length : i;
    };
    byIceRows.sort((a, b) => iceOrder(a.ice_state) - iceOrder(b.ice_state) || a.ice_state.localeCompare(b.ice_state));
    const totals = totalsRows[0] ?? { trips: 0, samples: 0, users: 0, active_trips: 0 };
    reply.send({
      totals: { trips: totals.trips, samples: totals.samples, users: totals.users, activeTrips: totals.active_trips },
      byNet: byNetRows.map((r) => ({
        netClass: r.net_class,
        nSamples: r.n_samples,
        nTrips: r.n_trips,
        rttMedian: r.rtt_median,
        rttP90: r.rtt_p90,
        lossPct: r.loss_pct,
        downMedianBps: r.down_median,
        upMedianBps: r.up_median,
      })),
      byIceState: byIceRows.map((r) => ({
        iceState: r.ice_state,
        nSamples: r.n_samples,
        nTrips: r.n_trips,
        availPct: r.avail_pct,
        lossPct: r.loss_pct,
        rttMedian: r.rtt_median,
      })),
    });
  });

  // In-Memory-Cache: die Live-Karte wird von vielen Besuchern alle 15s abgerufen, eine einzelne
  // Berechnung (mehrere Queries + Zusammenfassung) reicht für LIVE_CACHE_MS für alle.
  let liveCache: { at: number; body: PublicLive } | null = null;

  app.get('/api/public/live', async (_request, reply) => {
    reply.header('cache-control', `public, max-age=${Math.round(LIVE_CACHE_MS / 1000)}`);
    if (liveCache && Date.now() - liveCache.at < LIVE_CACHE_MS) {
      reply.send(liveCache.body);
      return;
    }

    const activeRows = await dbClient<{ active_trips: number }[]>`
      SELECT count(*)::int AS active_trips FROM trips WHERE last_sample_at >= now() - interval '5 minutes'
    `;
    const activeTrips = activeRows[0]?.active_trips ?? 0;

    // Je aktiver, öffentlich sichtbarer Fahrt die letzte Position der letzten LIVE_POSITION_MAX_AGE_MS
    // (DISTINCT ON liefert genau eine Zeile je Fahrt) sowie den zuletzt bekannten ICE-Status.
    const posRows = await dbClient<
      {
        trip_id: string;
        train_type: string;
        train_number: string | null;
        lat: number;
        lon: number;
        speed_mps: number | null;
        pos_age_ms: number;
        ice_state: string | null;
      }[]
    >`
      SELECT
        lt.trip_id,
        lt.train_type,
        lt.train_number,
        lp.lat,
        lp.lon,
        lp.speed_mps,
        (1000 * extract(epoch FROM (now() - lp.ts)))::int AS pos_age_ms,
        li.ice_state
      FROM (
        SELECT t.id AS trip_id, t.train_type, t.train_number
        FROM trips t
        JOIN users u ON u.id = t.user_id
        WHERE t.status = 'active' AND u.live_public = true
      ) lt
      JOIN LATERAL (
        SELECT s.lat, s.lon, s.speed_mps, s.ts
        FROM samples s
        WHERE s.trip_id = lt.trip_id AND s.lat IS NOT NULL AND s.lon IS NOT NULL
          AND s.ts >= now() - (${LIVE_POSITION_MAX_AGE_MS}::int * interval '1 millisecond')
        ORDER BY s.ts DESC
        LIMIT 1
      ) lp ON true
      LEFT JOIN LATERAL (
        SELECT s.ice_state
        FROM samples s
        WHERE s.trip_id = lt.trip_id AND s.ice_state IS NOT NULL
        ORDER BY s.ts DESC
        LIMIT 1
      ) li ON true
    `;

    let trains: ReturnType<typeof summarizeLiveTrains> = [];
    if (posRows.length > 0) {
      const tripIds = posRows.map((r) => r.trip_id);
      const pingRows = await dbClient<
        { trip_id: string; net_class: string; rtt_median: number | null; n: number; lost: number }[]
      >`
        SELECT trip_id, net_class, rtt_median, n, lost
        FROM samples
        WHERE trip_id = ANY(${dbClient.array(tripIds)}::uuid[]) AND kind = 'ping_window'
          AND ts >= now() - (${LIVE_NET_WINDOW_MS}::int * interval '1 millisecond')
      `;
      const pingsByTrip = new Map<string, LiveTripRow['pings']>();
      for (const p of pingRows) {
        const list = pingsByTrip.get(p.trip_id) ?? [];
        list.push({ netClass: p.net_class as NetClass, rttMedian: p.rtt_median, n: p.n ?? 0, lost: p.lost ?? 0 });
        pingsByTrip.set(p.trip_id, list);
      }

      const tripRows: LiveTripRow[] = posRows.map((r) => ({
        tripId: r.trip_id,
        trainType: r.train_type as TrainType,
        trainNumber: r.train_number,
        lat: r.lat,
        lon: r.lon,
        speedMps: r.speed_mps,
        posAgeMs: Number(r.pos_age_ms),
        iceState: r.ice_state,
        pings: pingsByTrip.get(r.trip_id) ?? [],
      }));

      const key = deriveKey(cfg.APP_SECRET, 'live-key');
      const signKey = (message: string) => createHmac('sha256', key).update(message).digest('base64url');
      trains = summarizeLiveTrains(tripRows, signKey);
    }

    const body: PublicLive = { activeTrips, trains, generatedAt: new Date().toISOString() };
    liveCache = { at: Date.now(), body };
    reply.send(body);
  });
}
