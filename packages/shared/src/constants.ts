/** Mess-Parameter, die Client und Server gemeinsam kennen müssen. */
export const PING_INTERVAL_MS = 1000;
/** Keine Antwort innerhalb dieser Zeit = verloren. */
export const PING_TIMEOUT_MS = 3000;
/** Der Client verdichtet Pings zu Fenstern dieser Länge, bevor er sie hochlädt. */
export const WINDOW_MS = 5000;
/** Standort-Samples mit schlechterer Genauigkeit werden clientseitig verworfen. */
export const MAX_ACCURACY_M = 200;
export const PROBE_INTERVAL_MS = 10_000;
export const WHOAMI_INTERVAL_MS = 30_000;
/** Erwarteter Body von /api/net/probe; alles andere deutet auf ein Captive Portal hin. */
export const PROBE_BODY = 'bahn-tracker-probe-ok';
export const SPEEDTEST_DURATION_MS = 8000;
export const SPEEDTEST_STREAMS = 4;
/** Harte Obergrenze je Richtung und Test. */
export const SPEEDTEST_MAX_BYTES = 50 * 1024 * 1024;
/** Pause zwischen zwei Tests im Dauer-Speedtest; genug Ping-Werte für die Leerlauf-RTT (rttIdleMs). */
export const SPEEDTEST_CONTINUOUS_PAUSE_MS = 5000;
export const BATCH_MAX_SAMPLES = 500;
export const BATCH_FLUSH_MS = 10_000;
/** Fahrt wird serverseitig als beendet markiert, wenn so lange nichts kommt. */
export const TRIP_IDLE_END_MS = 30 * 60_000;
/** Neue Fahrt im selben Zug innerhalb dieses Abstands setzt die vorherige Fahrt fort. */
export const TRIP_RESUME_WINDOW_MS = 10 * 60_000;
/** Gültigkeit eines signierten whoami-Tokens. */
export const NET_TOKEN_TTL_MS = 5 * 60_000;
export const MAGIC_LINK_TTL_MS = 15 * 60_000;
export const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;
/** Grobe Plausibilitäts-Box: Deutschland und Nachbarländer. */
export const BBOX = { west: 2.0, south: 44.5, east: 20.0, north: 57.0 } as const;
export const MAX_SPEED_MPS = 350 / 3.6;

/**
 * Standardwert für `users.live_public` (Einstellung „Live öffentlich“, siehe `/account`).
 * In der Testversion `true` (Opt-out), damit die Live-Karte auf der Startseite ohne manuelles
 * Zutun Daten zeigt. VOR dem öffentlichen Start auf `false` umstellen (Opt-in) – die DB-Spalte
 * muss dann denselben Default bekommen (neue Migration).
 */
export const LIVE_PUBLIC_DEFAULT = true;
/** Nur Fahrten mit einem Sample (mit Position) innerhalb dieses Zeitraums gelten als „live“. */
export const LIVE_POSITION_MAX_AGE_MS = 5 * 60_000;
/** Zeitfenster für die zusammengefasste RTT/Verlust-Anzeige je Netzklasse auf `/api/public/live`. */
export const LIVE_NET_WINDOW_MS = 2 * 60_000;
/** Cache-Dauer der In-Memory-Antwort von `/api/public/live`. */
export const LIVE_CACHE_MS = 10_000;
/**
 * Anzeigenamen für `connectivity.currentState` des ICE-Bordportals. Das ist keine Messung, sondern
 * die Abdeckungsprognose der DB für den aktuellen Streckenabschnitt. Unbekannte Werte roh anzeigen.
 */
export const ICE_STATE_LABELS: Record<string, string> = {
  HIGH: 'gut',
  MIDDLE: 'mittel',
  WEAK: 'schwach',
  LOW: 'schwach',
  UNSTABLE: 'instabil',
  NO_INTERNET: 'Funkloch',
  NO_INFO: 'keine Info',
};
/** Reihenfolge der Prognosestufen für Tabellen, von gut nach schlecht. */
export const ICE_STATE_ORDER = ['HIGH', 'MIDDLE', 'WEAK', 'LOW', 'UNSTABLE', 'NO_INTERNET', 'NO_INFO'] as const;
