import { BBOX, MAX_ACCURACY_M, MAX_SPEED_MPS } from '@bahn/shared';

const EARTH_RADIUS_M = 6_371_000;

/** Haversine-Distanz in Metern zwischen zwei lat/lon-Punkten. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function isOutOfBbox(lat: number | null, lon: number | null): boolean {
  if (lat === null || lon === null) return false;
  return lat < BBOX.south || lat > BBOX.north || lon < BBOX.west || lon > BBOX.east;
}

export function isBadAccuracy(accuracyM: number | null): boolean {
  if (accuracyM === null) return false;
  return accuracyM > MAX_ACCURACY_M;
}

/** Vergleicht die (schon um clockOffsetMs korrigierte) Sample-Zeit mit der Serverzeit. */
export function isClockSkew(correctedTs: number, serverNow: number): boolean {
  return Math.abs(correctedTs - serverNow) > 24 * 60 * 60_000;
}

export interface LastPosition {
  ts: number;
  lat: number;
  lon: number;
}

/**
 * Prüft, ob die Bewegung zwischen zwei Positionen physikalisch plausibel ist
 * (Distanz/Zeit <= MAX_SPEED_MPS). Bei <= 0 Zeitdifferenz oder fehlenden Werten kein Flag.
 */
export function isImplausibleSpeed(prev: LastPosition | null, curr: LastPosition): boolean {
  if (!prev) return false;
  const dtS = (curr.ts - prev.ts) / 1000;
  if (dtS <= 0) return false;
  const distM = haversineMeters(prev.lat, prev.lon, curr.lat, curr.lon);
  return distM / dtS > MAX_SPEED_MPS;
}
