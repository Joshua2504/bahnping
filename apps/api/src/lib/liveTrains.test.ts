import { describe, expect, it } from 'vitest';
import { median, round2, roundSpeedKmh, roundTo10Sec, summarizeLiveTrains, trainLabel, type LiveTripRow } from './liveTrains.js';

const identity = (msg: string): string => msg;

function row(overrides: Partial<LiveTripRow> & { tripId: string }): LiveTripRow {
  return {
    trainType: 'ice',
    trainNumber: '1077',
    lat: 51.5,
    lon: 9.9,
    speedMps: 50,
    posAgeMs: 10_000,
    iceState: null,
    pings: [],
    ...overrides,
  };
}

describe('liveTrains Rundung', () => {
  it('rundet lat/lon auf 2 Nachkommastellen', () => {
    expect(round2(51.123456)).toBe(51.12);
    expect(round2(9.999)).toBe(10);
  });

  it('rundet Geschwindigkeit in km/h', () => {
    expect(roundSpeedKmh(50)).toBe(180);
    expect(roundSpeedKmh(27.78)).toBe(100);
  });

  it('rundet lastSeenSec auf 10er-Schritte', () => {
    expect(roundTo10Sec(4_000)).toBe(0);
    expect(roundTo10Sec(6_000)).toBe(10);
    expect(roundTo10Sec(123_000)).toBe(120);
    expect(roundTo10Sec(126_000)).toBe(130);
  });

  it('berechnet den Median ungerade/gerade Anzahl', () => {
    expect(median([])).toBeNull();
    expect(median([80])).toBe(80);
    expect(median([80, 100, 60])).toBe(80);
    expect(median([80, 100])).toBe(90);
  });

  it('baut das Zuglabel mit/ohne Nummer', () => {
    expect(trainLabel('ice', '1077')).toBe('ICE 1077');
    expect(trainLabel('ice', null)).toBe('ICE');
  });
});

describe('summarizeLiveTrains Zusammenfassung', () => {
  it('fasst zwei Fahrten mit gleicher Zugnummer+Typ zu einem Eintrag zusammen', () => {
    const rows: LiveTripRow[] = [
      row({
        tripId: 'a',
        lat: 51.5,
        lon: 9.9,
        speedMps: 50,
        posAgeMs: 10_000,
        iceState: 'HIGH',
        pings: [{ netClass: 'mobile_telekom', rttMedian: 80, n: 10, lost: 1 }],
      }),
      row({
        tripId: 'b',
        lat: 51.52,
        lon: 9.92,
        speedMps: 54,
        posAgeMs: 30_000,
        iceState: 'LOW',
        pings: [{ netClass: 'mobile_telekom', rttMedian: 100, n: 10, lost: 0 }],
      }),
    ];
    const out = summarizeLiveTrains(rows, identity);
    expect(out).toHaveLength(1);
    const t = out[0];
    expect(t.label).toBe('ICE 1077');
    expect(t.trackers).toBe(2);
    expect(t.lat).toBe(round2((51.5 + 51.52) / 2));
    expect(t.lon).toBe(round2((9.9 + 9.92) / 2));
    expect(t.speedKmh).toBe(roundSpeedKmh((50 + 54) / 2));
    // posAgeMs 10_000 ist frischer -> iceState HIGH, lastSeenSec = 10
    expect(t.iceState).toBe('HIGH');
    expect(t.lastSeenSec).toBe(10);
    expect(t.nets).toEqual([{ netClass: 'mobile_telekom', rttMedian: 90, lossPct: 5 }]);
    // key = signKey(label) bei bekannter Zugnummer
    expect(t.key).toBe('ICE 1077'.slice(0, 12));
  });

  it('fasst Fahrten ohne Zugnummer NICHT zusammen und nutzt trip-basierten Schlüssel', () => {
    const rows: LiveTripRow[] = [
      row({ tripId: 'x', trainNumber: null, trainType: 'regio' }),
      row({ tripId: 'y', trainNumber: null, trainType: 'regio' }),
    ];
    const out = summarizeLiveTrains(rows, identity);
    expect(out).toHaveLength(2);
    expect(out.every((t) => t.trackers === 1)).toBe(true);
    expect(out.map((t) => t.key).sort()).toEqual(['trip:x', 'trip:y']);
    expect(out[0].label).toBe('RE / RB');
  });

  it('kürzt den Schlüssel auf 12 Zeichen und enthält nie die trip_id im Klartext bei bekannter Nummer', () => {
    const rows: LiveTripRow[] = [row({ tripId: 'super-secret-trip-id' })];
    const hmacLike = (msg: string) => `hashed:${msg}`;
    const out = summarizeLiveTrains(rows, hmacLike);
    expect(out[0].key).toHaveLength(12);
    expect(out[0].key).not.toContain('super-secret-trip-id');
  });

  it('liefert leere nets-Liste ohne Ping-Fenster', () => {
    const out = summarizeLiveTrains([row({ tripId: 'a', pings: [] })], identity);
    expect(out[0].nets).toEqual([]);
  });
});
