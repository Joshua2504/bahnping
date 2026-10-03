# API-Vertrag (Testversion)

Alle Request-/Response-Schemas liegen als Zod in `packages/shared/src/schemas.ts`; dieses Dokument
beschreibt Verhalten und Statuscodes. Fehler kommen als RFC 9457 Problem Details
(`application/problem+json`, Schema `Problem`). Auth über Session-Cookie `bt_session`
(HttpOnly, SameSite=Lax, Secure nur wenn PUBLIC_URL mit https beginnt) oder `Authorization: Bearer <api-token>`.
Mutierende Requests prüfen `Origin` bzw. `Sec-Fetch-Site` (same-origin/none erlaubt).

## Allgemein
- `GET /api/health` → `{ ok: true, db: true, asnRanges: number, time: number }`
- `GET /api/altcha/challenge` → ALTCHA-Challenge-JSON (`altcha-lib createChallenge`, HMAC-Key aus APP_SECRET,
  `maxNumber` ~ 100000, `expires` 10 min). Verifikation serverseitig mit Replay-Schutz (Challenge nur einmal gültig).

## Auth / Konto
- `POST /api/auth/magic-link` Body `MagicLinkRequest` → immer `204`, auch bei Fehlern beim Versand
  (kein Nutzer-Enumeration). ALTCHA Pflicht. Limit 3 Mails je E-Mail pro Stunde (im RAM). Mail enthält
  `${PUBLIC_URL}/auth/confirm?token=<token>`; Token 32 Byte base64url, DB speichert SHA-256, 15 min, einmalig.
  Nutzer wird beim Bestätigen angelegt, falls neu.
- `POST /api/auth/confirm` Body `ConfirmRequest` → `200 Me` + Set-Cookie. Token ungültig/abgelaufen → `400`.
- `POST /api/auth/logout` → `204`, löscht Session. `POST /api/auth/logout-all` → `204`.
- `GET /api/me` → `200 Me` oder `401`.
- `PATCH /api/me` Body `MeUpdate` (ALTCHA Pflicht) → `200 Me`; Name bereits vergeben → `409`.
- `DELETE /api/me` → `204`, löscht Nutzer samt Fahrten/Samples (Cascade).
- `GET /api/me/export` → JSON `{ user, trips: [{...trip, samples: [...] }] }`.

## Fahrten / Messwerte (Auth Pflicht)
- `POST /api/trips` Body `TripCreate` → `201 Trip`. Es darf nur eine aktive Fahrt je Nutzer geben; eine
  ältere aktive wird automatisch mit `status=ended` geschlossen.
- `GET /api/trips` → `200 Trip[]` (eigene, neueste zuerst, mit `sampleCount`).
- `GET /api/trips/:id` → `200 Trip` (nur eigene, sonst 404).
- `POST /api/trips/:id/end` Body `TripEnd` → `200 Trip`.
- `POST /api/trips/:id/samples` Body `SampleBatch` (JSON; optional `Content-Encoding: gzip`) → `200 SampleBatchResponse`.
  - idempotent über `id` (ON CONFLICT DO NOTHING → zählt als `duplicates`).
  - Server berechnet `ts = client ts + trip.clockOffsetMs`, `h3_r8`/`h3_r9` aus lat/lon (h3-js `latLngToCell`).
  - `net`-Token: Signatur prüfen (HMAC wie whoami). Gültig → `asn`, `net_class`, `ip_version` übernehmen,
    auch wenn `exp` abgelaufen ist (Offline-Upload). Ungültig → `net_class=unknown` + Flag `net_sig_invalid`.
  - Flags statt Ablehnung: `out_of_bbox` (außerhalb `BBOX`), `bad_accuracy` (> MAX_ACCURACY_M),
    `implausible_speed` (Distanz/Zeit zum letzten Sample der Fahrt > MAX_SPEED_MPS), `clock_skew`
    (korrigierte ts weicht > 24 h von Serverzeit ab). Rejected nur bei Schemafehlern einzelner Samples.
  - aktualisiert `trips.last_sample_at`.

## Netz
- `GET /api/net/whoami` → `200 WhoamiResponse`. Client-IP aus Socket bzw. `X-Forwarded-For` (nur wenn
  TRUST_PROXY) → Lookup in der In-Memory-Range-Tabelle (iptoasn TSV, Format `start\tend\tasn\tcountry\tname`,
  IPv4 und IPv6, sortiert, binäre Suche) → Klasse aus `asn_catalog` (Seed `ASN_SEED` + `NETCLASS_OVERRIDES`),
  unbekannte ASN → `unknown` und Upsert in `asn_catalog` mit `seen+1`. Private/Loopback-Adressen → asn 0,
  `private`. Die IP wird in keiner Variable länger gehalten als für den Lookup nötig und nie geloggt.
  `sig = base64url(HMAC-SHA256(APP_SECRET-abgeleiteter Key, `${asn}|${netClass}|${ipVersion ?? ''}|${exp}`))`.
  `label` = `NET_CLASS_LABELS[netClass]` + ggf. AS-Name.
- `GET /api/net/probe` → `200 text/plain` exakt `PROBE_BODY`, Header `Cache-Control: no-store`.
- `WS /ws` (kein Auth nötig): Server sendet `hello`, danach alle `PING_INTERVAL_MS` ein `ping {seq}`; Client
  antwortet `pong {seq}`; Server misst RTT und sendet `rtt {seq, rttMs}`. Client kann `sync {cid, t0}`
  senden, Server antwortet `sync {cid, t0, t1, t2}` (t1 Empfang, t2 Senden, Epoch-ms). Verbindung ohne pong
  für 60 s wird geschlossen.

## Speedtest (Auth Pflicht, Quota 1 Test / SPEEDTEST_COOLDOWN_MS je Nutzer, im RAM)
- `GET /api/speed/down?bytes=N` → `200 application/octet-stream`, N ≤ SPEEDTEST_MAX_BYTES, Zufallsdaten aus
  einem beim Start erzeugten 4-MiB-Puffer, `Cache-Control: no-store`, `Content-Encoding: identity`.
- `POST /api/speed/up` → Body (octet-stream, ≤ SPEEDTEST_MAX_BYTES) wird gezählt und verworfen → `{ bytes }`.
- Quota: `POST /api/speed/start` → `204` oder `429` mit `Retry-After`. Der Client ruft `start` vor dem Test.

## Öffentlich (kein Auth)
- `GET /api/public/cells?res=&bbox=&net=&period=&train=&mine=` → `200 CellsResponse`.
  Aggregation direkt aus `samples` (`GROUP BY h3_r8` bzw. `h3_r9`), nur Samples ohne Flags
  `out_of_bbox|bad_accuracy|implausible_speed|net_sig_invalid`. `rttMedian` = percentile_cont(0.5) über
  `rtt_median` der Ping-Fenster, `lossPct` = 100·Σlost/Σn, `availPct` = Anteil Fenster mit n>lost,
  `down/up` = Median der Speedtests (null wenn keine). Zellen mit `nTrips < PUBLIC_MIN_TRIPS` werden
  weggelassen, außer `mine=true` und eingeloggt (dann nur eigene Samples). bbox begrenzt die Zellen über
  lat/lon der Samples. Antwort `Cache-Control: public, max-age=60`.
- `GET /api/public/stats` → `200 PublicStats`.
- `GET /api/public/live` → `{ activeTrips }` (Fahrten mit `last_sample_at` in den letzten 5 min).

## Statisch
- `WEB_DIST` gesetzt → Dateien aus dem Verzeichnis, unbekannte Pfade ohne `/api`, `/ws`, `/mailpit`, `/tiles` → `index.html`.
- `TILES_DIR` gesetzt → `/tiles/*` statisch mit Range-Support (`basemap.pmtiles`, `fonts/…`, `sprites/…`).
- `MAILPIT_UPSTREAM` gesetzt → `/mailpit/*` Reverse-Proxy (inkl. WebSocket) auf Mailpit (Webroot `/mailpit`).

## Logging
Fastify-Logger mit `disableRequestLogging: true`; eigener onResponse-Hook loggt nur Methode, Route (nicht URL mit
Query), Status, Dauer. Keine Header, keine IPs, keine E-Mail-Adressen in Logs.
