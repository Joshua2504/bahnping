import { TRAIN_TYPE_LABELS, type LiveTrain, type LiveTrainNet, type NetClass, type TrainType } from '@bahn/shared';

/** Ein Ping-Fenster (`kind='ping_window'`) der letzten `LIVE_NET_WINDOW_MS`, für die Netzzusammenfassung. */
export interface LivePing {
  netClass: NetClass;
  rttMedian: number | null;
  n: number;
  lost: number;
}

/** Eine aktive, öffentlich sichtbare Fahrt mit frischer Position, roh aus der DB gelesen. */
export interface LiveTripRow {
  tripId: string;
  trainType: TrainType;
  trainNumber: string | null;
  lat: number;
  lon: number;
  speedMps: number | null;
  /** Alter des Positions-Samples in ms (now - ts). */
  posAgeMs: number;
  iceState: string | null;
  /** Nächster Halt laut ICE-Portal und Verspätung dort in Minuten (null = unbekannt). */
  nextStop?: string | null;
  delayMin?: number | null;
  pings: LivePing[];
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundSpeedKmh(speedMps: number): number {
  return Math.round(speedMps * 3.6);
}

/** Rundet ms auf ganze Sekunden, danach auf das nächste Vielfache von 10 Sekunden. */
export function roundTo10Sec(ms: number): number {
  return Math.round(ms / 10_000) * 10;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Zuglabel wie auf der Live-Karte angezeigt, z.B. "ICE 1077" oder nur "ICE" ohne Nummer. */
export function trainLabel(trainType: TrainType, trainNumber: string | null): string {
  return trainNumber ? `${TRAIN_TYPE_LABELS[trainType]} ${trainNumber}` : TRAIN_TYPE_LABELS[trainType];
}

/** Gruppenschlüssel: gleicher Typ + gleiche Zugnummer werden zusammengefasst, sonst je Fahrt einzeln. */
function groupKey(row: LiveTripRow): string {
  return row.trainNumber ? `${row.trainType}|${row.trainNumber}` : `trip:${row.tripId}`;
}

/**
 * Fasst aktive Fahrten mit gleicher Zugnummer + Typ zu einem Live-Zug zusammen, rundet Position
 * (2 Nachkommastellen), Geschwindigkeit (km/h, ganzzahlig) und `lastSeenSec` (10er-Schritte), und
 * bildet je Netzklasse Median-RTT/Verlust über alle Ping-Fenster der zusammengefassten Fahrten.
 * Reine Funktion (keine DB/Krypto), damit sie ohne Fixtures testbar ist; `signKey` übernimmt die
 * eigentliche HMAC-Bildung (siehe `routes/public.ts`), damit hier kein APP_SECRET nötig ist.
 */
export function summarizeLiveTrains(rows: LiveTripRow[], signKey: (message: string) => string): LiveTrain[] {
  const groups = new Map<string, LiveTripRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const members = groups.get(key);
    if (members) members.push(row);
    else groups.set(key, [row]);
  }

  const out: LiveTrain[] = [];
  for (const members of groups.values()) {
    const first = members[0];
    const label = trainLabel(first.trainType, first.trainNumber);
    const lat = round2(members.reduce((sum, m) => sum + m.lat, 0) / members.length);
    const lon = round2(members.reduce((sum, m) => sum + m.lon, 0) / members.length);

    const speeds = members.map((m) => m.speedMps).filter((v): v is number => v !== null);
    const speedKmh = speeds.length > 0 ? roundSpeedKmh(speeds.reduce((sum, v) => sum + v, 0) / speeds.length) : null;

    const byNet = new Map<NetClass, { rtts: number[]; n: number; lost: number }>();
    for (const m of members) {
      for (const p of m.pings) {
        const entry = byNet.get(p.netClass) ?? { rtts: [], n: 0, lost: 0 };
        if (p.rttMedian !== null) entry.rtts.push(p.rttMedian);
        entry.n += p.n;
        entry.lost += p.lost;
        byNet.set(p.netClass, entry);
      }
    }
    const nets: LiveTrainNet[] = [...byNet.entries()].map(([netClass, e]) => ({
      netClass,
      rttMedian: median(e.rtts),
      lossPct: e.n > 0 ? (100 * e.lost) / e.n : null,
    }));

    // Frischestes Tracker-Sample bestimmt lastSeenSec/iceState, falls sich mehrere unterscheiden.
    const freshest = members.reduce((a, b) => (a.posAgeMs <= b.posAgeMs ? a : b));
    const iceState = freshest.iceState ?? members.find((m) => m.iceState !== null)?.iceState ?? null;
    const withStop = members.find((m) => m.nextStop) ?? null;

    const message = first.trainNumber ? label : `trip:${first.tripId}`;
    out.push({
      key: signKey(message).slice(0, 12),
      label,
      lat,
      lon,
      speedKmh,
      trackers: members.length,
      nets,
      lastSeenSec: roundTo10Sec(freshest.posAgeMs),
      iceState,
      nextStop: withStop?.nextStop ?? null,
      delayMin: withStop?.delayMin ?? null,
    });
  }
  return out;
}
