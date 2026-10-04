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
- `GET /api/me` → `200 Me` oder `401`. Setzt dabei `role='admin'`, falls die E-Mail in
  `ADMIN_EMAILS` steht (ebenso bei `POST /api/auth/confirm`); die Rolle wird nie automatisch
  wieder entfernt.
- `PATCH /api/me` Body `MeUpdate` (ALTCHA Pflicht) → `200 Me`; Name bereits vergeben → `409`.
- `PATCH /api/me/settings` Body `MeSettingsUpdate` (`{ livePublic: boolean }`, kein ALTCHA nötig,
  da keine Enumerations-/Spam-Gefahr) → `200 Me`. Cookie- oder Bearer-Auth. Steuert, ob laufende
  Fahrten anonymisiert auf `/api/public/live` erscheinen (siehe dort), Standard
  `LIVE_PUBLIC_DEFAULT` (`packages/shared/src/constants.ts`, aktuell `true`/Opt-out in der
  Testversion; vor dem öffentlichen Start auf `false`/Opt-in umstellen).
- `DELETE /api/me` → `204`, löscht Nutzer samt Fahrten/Samples (Cascade). Nur mit Sitzungs-Login,
  nicht mit API-Token (`403`).
- `GET /api/me/export` → JSON `{ user, trips: [{...trip, samples: [...] }] }`.
- `Me` enthält zusätzlich `livePublic: boolean` (siehe oben).

## API-Tokens (CLI/App)

Für die CLI (`tools/cli`) und andere nicht-browserbasierte Clients: `Authorization: Bearer <token>`
statt Session-Cookie. Token-Format `bnt_` + 32 Byte base64url; gespeichert wird nur der SHA-256-Hash
(`api_tokens.token_hash`). `lastUsedAt` wird höchstens alle 10 Minuten aktualisiert. Widerrufene
Tokens (`revoked_at` gesetzt) werden vom Auth-Hook nicht mehr akzeptiert.

Token-Verwaltung und Kontolöschung sind **nur mit Sitzungs-Login** möglich, nie mit einem
Bearer-Token selbst (sonst `403`) – ein gestohlenes Token könnte sich sonst selbst verlängern.

- `GET /api/tokens` → `200 ApiTokenInfo[]` (eigene, nicht widerrufene). `id` = die ersten 12 Zeichen
  des `token_hash` (hex), dient nur als öffentliche Kennung für `DELETE`.
- `POST /api/tokens` Body `ApiTokenCreate` (ALTCHA Pflicht) → `201 ApiTokenCreated` (enthält `token`
  im Klartext, wird danach nie wieder ausgegeben). Maximal 20 aktive Tokens je Nutzer, sonst `400`.
- `DELETE /api/tokens/:id` → `204` (setzt `revoked_at`), `404` falls unbekannt/fremd/bereits widerrufen.

## Fahrten / Messwerte (Auth Pflicht)
- `POST /api/trips` Body `TripCreate` → `201 Trip`. Es darf nur eine aktive Fahrt je Nutzer geben; eine
  ältere aktive wird automatisch mit `status=ended` geschlossen.
  - Fortsetzen: Gibt es eine Fahrt des Nutzers mit gleicher Gattung und Zugnummer, deren letzte Aktivität
    (`last_sample_at`, sonst `ended_at`/`started_at`) höchstens `TRIP_RESUME_WINDOW_MS` (10 min) zurückliegt,
    wird diese wieder `active` gesetzt und mit `200 Trip` zurückgegeben (gleiche ID). Ohne Zugnummer kein Fortsetzen.
- `GET /api/trips` → `200 Trip[]` (eigene, neueste zuerst, mit `sampleCount`).
- `GET /api/trips/:id` → `200 Trip` (nur eigene, sonst 404).
- `POST /api/trips/:id/end` Body `TripEnd` → `200 Trip`.
- `PATCH /api/trips/:id` Body `TripUpdate` → `200 Trip` (nur eigene; z.B. wenn die CLI die
  Zugnummer erst nachträglich aus dem ICE-Portal erfährt). Auch per Bearer-Token nutzbar.
  Wird dabei die Zugnummer einer aktiven Fahrt gesetzt und passt eine vorherige Fahrt nach denselben
  Regeln wie beim Fortsetzen, werden deren Samples in diese Fahrt übernommen (`startedAt` der älteren),
  die ältere Fahrt wird gelöscht. Die ID der aktiven Fahrt bleibt erhalten.
  Zusätzlich (CLI, aus dem ICE-Portal): `iceTzn` (Triebzugnummer, physische Einheit, z.B. "ICE9012"),
  `iceSeries` (Baureihe, z.B. "412"), `tripDate` (YYYY-MM-DD), `originName`, `destinationName` →
  `trips.ice_tzn`/`ice_series`/`trip_date`/`origin_name`/`destination_name`, werden in `Trip` zurückgegeben.
- `PUT /api/trips/:id/stops` Body `TripStopsPut` (`{ stops: TripStop[] }`, max. 200) → `204` (nur eigene,
  sonst 404). Ersetzt die Halteliste der Fahrt komplett (Tabelle `trip_stops`, PK `trip_id, seq`): je Halt
  `seq`, `evaNr`, `name`, `lat`/`lon`, Soll-/Ist-Ankunft und -Abfahrt (ISO), Gleis soll/ist, `passed`,
  `positionStatus`. Die CLI sendet den Stand nur bei Änderung (Fingerprint), höchstens alle 10 s; so bleibt
  je Fahrt der letzte Stand inkl. Ist-Zeiten (Verspätungsentwicklung) erhalten.
- `POST /api/trips/:id/samples` Body `SampleBatch` (JSON; optional `Content-Encoding: gzip`) → `200 SampleBatchResponse`.
  - idempotent über `id` (ON CONFLICT DO NOTHING → zählt als `duplicates`).
  - `n`/`lost` eines Ping-Fensters zählt der Client über die Sequenznummern der Server-Pings: `n` =
    Anzahl Sequenznummern seit der letzten empfangenen Antwort des Vorfensters, `lost = n − empfangen`.
    Ein Fenster ohne jede Antwort zählt als `WINDOW_MS / PING_INTERVAL_MS` verloren. So erzeugt Timer-Drift
    (mal 4, mal 6 Antworten je 5-s-Fenster) keinen Scheinverlust (`windows.ts`, CLI `stats.Aggregator`).
  - Server berechnet `ts = client ts + trip.clockOffsetMs`, `h3_r8`/`h3_r9` aus lat/lon (h3-js `latLngToCell`).
  - `iceState`/`posSource` (siehe Schema `Sample` in `packages/shared`) werden unverändert in
    `samples.ice_state`/`samples.pos_source` übernommen und von `GET /api/trips/:id/samples` zurückgegeben.
    Ebenso die Portal-Prognose `iceNextState`/`iceRemainingS` (`connectivity.nextState`/
    `remainingTimeSeconds`) und der separate Indikator `iceInternet` (`internet`, z.B. HIGH/OFFLINE) →
    `samples.ice_next_state`/`ice_remaining_s`/`ice_internet`.
  - `net`-Token: Signatur prüfen (HMAC wie whoami). Gültig → `asn`, `net_class`, `ip_version` übernehmen,
    auch wenn `exp` abgelaufen ist (Offline-Upload). Ungültig → `net_class=unknown` + Flag `net_sig_invalid`.
  - Flags statt Ablehnung: `out_of_bbox` (außerhalb `BBOX`), `bad_accuracy` (> MAX_ACCURACY_M),
    `implausible_speed` (Distanz/Zeit zum letzten Sample der Fahrt > MAX_SPEED_MPS), `clock_skew`
    (korrigierte ts weicht > 24 h von Serverzeit ab). Rejected nur bei Schemafehlern einzelner Samples.
  - aktualisiert `trips.last_sample_at`.
- `GET /api/trips/:id/samples?since=<ISO>` → `200 TripSamples` (öffentlich ohne Auth, Zugriff über die
  nicht erratbare Fahrt-ID; unbekannte/ungültige ID → 404):
  `{ trip, samples, asns, stops, serverTime }`. `stops` ist die Halteliste (`TripStop[]`, nach `seq`;
  leer bei Browser-Fahrten). `samples` enthält alle Samples der Fahrt in zeitlicher
  Reihenfolge (reduzierte Felder, siehe Schema `TripSample`), `asns` die je ASN gesehenen Samples
  (`asn`, `name`, `netClass`, `samples`, stets über die gesamte Fahrt, unabhängig von `since`).
  Jedes Sample liefert zusätzlich `iceState`/`posSource` (noch nicht Teil des `TripSample`-Schemas in
  `packages/shared`, das parallel bearbeitet wird; Web-Client erweitert lokal, siehe `apps/web/src/lib/api.ts`).
  `serverTime` (ISO) ist die Serverzeit beim Erstellen der Antwort; der Client nutzt sie als nächsten
  `since`-Wert für inkrementelles Nachladen einer laufenden Fahrt (siehe `/trips/[id]`, Polling alle
  5 s). `since` filtert über `samples.created_at` (nicht `ts`), damit verspätet eingetroffene Samples
  mit älterem (korrigiertem) `ts` nicht übersprungen werden; `trip.sampleCount` zeigt dabei weiterhin
  die Gesamtzahl der Fahrt, nicht nur den neu geladenen Ausschnitt.

## Admin (Auth + Rolle `admin` Pflicht, sonst `401`/`403`)
- `GET /api/admin/asns?filter=unknown|all` → `200 AdminAsn[]`, sortiert nach `seen` absteigend.
  Je ASN zusätzlich Anzahl Samples und (verschiedener) Fahrten.
- `PATCH /api/admin/asns/:asn` Body `AdminAsnUpdate` (`{ netClass }`) → `200 AdminAsnUpdateResponse`
  (`{ asn: AdminAsn, samplesUpdated }`). Setzt `source='admin'`, `reviewedAt=now()`, aktualisiert die
  In-Memory-Klasse im `AsnService` sofort und schreibt `net_class` auf alle bestehenden `samples`
  dieser ASN zurück, **außer** solche mit Flag `net_sig_invalid`.
- `GET /api/admin/smtp` → `200 SmtpSettings` (`{ mode, host, port, security, user, from,
  rejectUnauthorized, passwordSet, envDefaults: { host, port, from } }`). Das Passwort wird nie
  zurückgegeben, nur `passwordSet`.
- `PUT /api/admin/smtp` Body `SmtpSettingsUpdate` (`{ mode, host, port, security, user, password?,
  from, rejectUnauthorized }`) → `200 SmtpSettings`. `password` fehlt → bestehendes Passwort bleibt
  erhalten; `password: ""` → Passwort wird gelöscht. Speichert in `app_settings` (Key `smtp`,
  Passwort AES-256-GCM-verschlüsselt mit einem von `APP_SECRET` abgeleiteten Schlüssel, Zweck
  `smtp-password`) und baut den Mail-Transport sofort neu auf (`MailService.reload()`). Bei
  `mode='env'` werden die ENV-Variablen `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM`
  genutzt (Testversion: Mailpit), bei `mode='custom'` die gespeicherte Konfiguration. `security`:
  `'tls'` → `secure:true`, `'starttls'` → `secure:false, requireTLS:true`, `'none'` →
  `secure:false, ignoreTLS:true`; dazu `tls.rejectUnauthorized`. Timeouts: connection/greeting 10 s,
  socket 20 s.
- `POST /api/admin/smtp/test` Body `SmtpTestRequest` (`{ to? }`, Standard: E-Mail des aufrufenden
  Admins) → `200 SmtpTestResponse` (`{ ok: true, messageId }`) oder `502` mit verständlicher
  Fehlermeldung (Auth fehlgeschlagen, Verbindung abgelehnt, Zeitüberschreitung, Zertifikat
  ungültig), abgeleitet aus `err.code`/`responseCode`, ohne Interna zu verraten. Kein Rate-Limit (nur Admins).

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

## Speedtest (Auth Pflicht, kein Cooldown)
- `GET /api/speed/down?bytes=N` → `200 application/octet-stream`, N ≤ SPEEDTEST_MAX_BYTES, Zufallsdaten aus
  einem beim Start erzeugten 4-MiB-Puffer, `Cache-Control: no-store`, `Content-Encoding: identity`.
- `POST /api/speed/up` → Body (octet-stream, ≤ SPEEDTEST_MAX_BYTES) wird gezählt und verworfen → `{ bytes }`.
- `POST /api/speed/start` → `204`. Früher Quota (429 mit `Retry-After`), jetzt ohne Limit; bleibt für
  bestehende Clients erhalten, die `start` vor jedem Test aufrufen.

## Öffentlich (kein Auth)
- `GET /api/public/cells?res=&bbox=&net=&period=&train=&mine=` → `200 CellsResponse`.
  Aggregation direkt aus `samples` (`GROUP BY h3_r8` bzw. `h3_r9`), nur Samples ohne Flags
  `out_of_bbox|bad_accuracy|implausible_speed|net_sig_invalid`. `rttMedian` = percentile_cont(0.5) über
  `rtt_median` der Ping-Fenster, `lossPct` = 100·Σlost/Σn, `availPct` = Anteil Fenster mit n>lost,
  `down/up` = Median der Speedtests (null wenn keine). Zellen mit `nTrips < PUBLIC_MIN_TRIPS` werden
  weggelassen, außer `mine=true` und eingeloggt (dann nur eigene Samples). bbox begrenzt die Zellen über
  lat/lon der Samples. Antwort `Cache-Control: public, max-age=60`.
- `GET /api/public/stats` → `200 PublicStats` (`{ totals, byNet, byIceState }`).
  - `byIceState`: je ICE-Portal-Prognose (`connectivity.currentState`, groß geschrieben) über alle
    `ping_window`-Samples mit gesetztem `iceState` (ohne ausgeschlossene Flags): `nSamples`, `nTrips`,
    `availPct` (Anteil Fenster mit `n > lost`, wie bei `/cells`), `lossPct`, `rttMedian`. Sortiert
    nach `ICE_STATE_ORDER`, unbekannte Werte am Ende. Vergleicht die Prognose der DB mit der Messung.
- `GET /api/public/live` → `200 PublicLive` (`{ activeTrips, trains, generatedAt }`),
  `Cache-Control: public, max-age=10`, zusätzlich serverseitiger In-Memory-Cache über `LIVE_CACHE_MS`
  (10s), damit die 15s-Polling-Last der Live-Karte nicht pro Request neu berechnet wird.
  - `activeTrips` zählt wie bisher alle Fahrten mit `last_sample_at` in den letzten 5 Minuten,
    unabhängig von `livePublic`.
  - `trains: LiveTrain[]`: je Fahrt mit `status='active'`, deren Nutzer `live_public=true` hat und
    die ein Sample mit Position innerhalb der letzten `LIVE_POSITION_MAX_AGE_MS` (5 min) besitzt.
    Fahrten mit gleicher Zugnummer + gleichem Zugtyp werden zu einem Eintrag zusammengefasst
    (reine Zusammenfassung/Rundung in `apps/api/src/lib/liveTrains.ts`, per Vitest getestet):
    - `label`: `train_type`-Label + Zugnummer (z.B. "ICE 1077"), ohne Nummer nur das Typ-Label.
    - `nextStop`/`delayMin`: erster nicht passierter Halt aus `trip_stops` und Verspätung dort in Minuten
      (Ist − Soll der Ankunft), `null` wenn unbekannt (Browser-Fahrten).
    - `lat`/`lon`: Mittel der letzten Positionen der zusammengefassten Fahrten, je auf 2
      Nachkommastellen gerundet (~1 km Genauigkeit).
    - `speedKmh`: Mittel der letzten `speed_mps`-Werte (sofern vorhanden) in km/h, ganzzahlig
      gerundet, sonst `null`.
    - `trackers`: Anzahl zusammengefasster Fahrten.
    - `nets`: je Netzklasse Median-RTT und Verlust-% über alle `ping_window`-Samples der letzten
      `LIVE_NET_WINDOW_MS` (2 min) der zusammengefassten Fahrten.
    - `lastSeenSec`: Alter des frischesten Positions-Samples in Sekunden, auf 10er-Schritte gerundet.
    - `iceState`: letzter bekannter ICE-Portal-Status der frischesten zusammengefassten Fahrt,
      sonst der erste gefundene, sonst `null`.
    - `key`: HMAC-SHA256 (von `APP_SECRET` abgeleiteter Schlüssel, Zweck `live-key`) über das Label
      (bei bekannter Zugnummer) bzw. über die Fahrt-ID (sonst), base64url, auf 12 Zeichen gekürzt.
      Dient nur als über mehrere Abrufe stabiler Client-Key, ist aber nie die Fahrt-ID selbst.
    - Enthält absichtlich **keine** Nutzer-ID, keinen Namen, keine E-Mail und keine Fahrt-ID.

## Downloads
- `GET /dl/<dateiname>` → CLI-Binaries aus `DOWNLOADS_DIR` (relativ zu `apps/api`, Standard
  `../../.run/dist`), z.B. `/dl/bahnnet-linux-amd64`. `Content-Disposition: attachment`,
  `Cache-Control: no-cache`. Fehlt das Verzeichnis, wird nur gewarnt und `/dl/*` liefert `404`.

## Statisch
- `WEB_DIST` gesetzt → Dateien aus dem Verzeichnis, unbekannte Pfade ohne `/api`, `/ws`, `/mailpit`, `/tiles`, `/dl` → `index.html`.
- `TILES_DIR` gesetzt → `/tiles/*` statisch mit Range-Support (`basemap.pmtiles`, `fonts/…`, `sprites/…`).
- `MAILPIT_UPSTREAM` gesetzt → `/mailpit/*` Reverse-Proxy (inkl. WebSocket) auf Mailpit (Webroot `/mailpit`).

## Serverseitige Jobs
`apps/api/src/jobs.ts`, alle 5 Minuten (einmal sofort beim Start), Logging nur als Zähler:
- Aktive Fahrten ohne neue Samples seit `TRIP_IDLE_END_MS` → `status='ended'`,
  `ended_at = coalesce(last_sample_at, started_at)`.
- Abgelaufene Sessions (`sessions.expires_at`) und nicht mehr gültige Magic Links
  (`magic_links.expires_at`) werden gelöscht.

## Logging
Fastify-Logger mit `logController: new LogController({ disableRequestLogging: true })` (ersetzt das in
Fastify 5.12 deprecated Top-Level-Flag `disableRequestLogging`); eigener onResponse-Hook loggt nur
Methode, Route (nicht URL mit Query), Status, Dauer. Keine Header, keine IPs, keine E-Mail-Adressen in Logs.
Der Postgres-Client (`postgres.js`) unterdrückt NOTICE-Ausgaben (`onnotice: () => {}`), damit Migrationen
(z.B. `relation already exists, skipping`) nicht im Log/Terminal erscheinen.
