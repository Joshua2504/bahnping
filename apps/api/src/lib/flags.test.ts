import { describe, expect, it } from 'vitest';
import { haversineMeters, isBadAccuracy, isClockSkew, isImplausibleSpeed, isOutOfBbox } from './flags.js';

describe('flags', () => {
  it('erkennt Koordinaten außerhalb der BBOX', () => {
    expect(isOutOfBbox(52.5, 13.4)).toBe(false); // Berlin, innerhalb
    expect(isOutOfBbox(40.7, -74.0)).toBe(true); // New York, außerhalb
    expect(isOutOfBbox(null, null)).toBe(false);
  });

  it('erkennt schlechte Genauigkeit', () => {
    expect(isBadAccuracy(50)).toBe(false);
    expect(isBadAccuracy(201)).toBe(true);
    expect(isBadAccuracy(null)).toBe(false);
  });

  it('erkennt Clock-Skew über 24h', () => {
    const now = Date.now();
    expect(isClockSkew(now, now)).toBe(false);
    expect(isClockSkew(now - 25 * 60 * 60_000, now)).toBe(true);
    expect(isClockSkew(now - 23 * 60 * 60_000, now)).toBe(false);
  });

  it('berechnet eine plausible Haversine-Distanz (Berlin -> Hamburg ~ 255km)', () => {
    const distM = haversineMeters(52.52, 13.405, 53.5511, 9.9937);
    expect(distM).toBeGreaterThan(250_000);
    expect(distM).toBeLessThan(260_000);
  });

  it('erkennt physikalisch unplausible Geschwindigkeit', () => {
    const prev = { ts: 0, lat: 52.52, lon: 13.405 };
    // 10km in 1s ist weit über MAX_SPEED_MPS (350 km/h)
    const curr = { ts: 1000, lat: 52.61, lon: 13.405 };
    expect(isImplausibleSpeed(prev, curr)).toBe(true);
  });

  it('akzeptiert plausible ICE-Geschwindigkeit', () => {
    const prev = { ts: 0, lat: 52.52, lon: 13.405 };
    // ca. 1km in 10s = 100 m/s = 360 km/h -> knapp über dem Limit, daher kleineren Wert nehmen
    const curr = { ts: 10_000, lat: 52.525, lon: 13.405 }; // ~556m in 10s = 55.6 m/s
    expect(isImplausibleSpeed(prev, curr)).toBe(false);
  });

  it('ohne vorherige Position gibt es kein Flag', () => {
    expect(isImplausibleSpeed(null, { ts: 0, lat: 52.52, lon: 13.405 })).toBe(false);
  });
});
