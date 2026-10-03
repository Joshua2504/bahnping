import type { FastifyInstance } from 'fastify';
import { CellsQuery, type CellRow } from '@bahn/shared';
import { parseOrProblem } from '../lib/validate.js';
import { sendProblem } from '../lib/problem.js';

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
    });
  });

  app.get('/api/public/live', async (_request, reply) => {
    const rows = await dbClient<{ active_trips: number }[]>`
      SELECT count(*)::int AS active_trips FROM trips WHERE last_sample_at >= now() - interval '5 minutes'
    `;
    reply.send({ activeTrips: rows[0]?.active_trips ?? 0 });
  });
}
