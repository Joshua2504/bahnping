# Bahn-Netzwerk-Tracker – Planung

Stand: 2026-10-03 · Status: Entwurf zur Diskussion, noch keine Zeile Code

## 1. Ziel

Eine öffentliche, selbst gehostete Plattform, die misst, wie gut das Netz in Zügen der Deutschen Bahn
tatsächlich ist – getrennt nach **DB-WLAN (WIFIonICE / WIFI@DB)** und **eigenem Mobilfunk** – und das
Ergebnis als Heatmap entlang der Bahnstrecken veröffentlicht.

Nutzer:innen loggen sich per E-Mail-Magic-Link ein, starten im Zug eine „Fahrt“, und das Tool erfasst
kontinuierlich Standort, Latenz/Paketverlust und auf Knopfdruck Durchsatz (Speedtest). Dazu ein
IP-/Provider-Check und Live-Statistiken während der Fahrt.

Nicht verhandelbare Rahmenbedingungen:

- Komplett self-hosted (Karte, Kacheln, AS-Datenbank, Captcha, Mail). Keine Drittanbieter-Requests im Browser.
- IP-Adressen werden **nie** gespeichert. Sie werden nur im Arbeitsspeicher für den AS-Lookup verwendet.
- Spam-/Bot-Schutz mit ALTCHA (Proof-of-Work, self-hosted).
- DSGVO-sauber: aggregierte Veröffentlichung, Konto- und Datenlöschung, Export.

## 2. Entscheidungen auf einen Blick (TL;DR)

| Thema | Entscheidung |
|---|---|
| Plattform-Strategie | **Web-first als PWA**, später **Capacitor-Apps** (Android zuerst) aus derselben Codebasis für Hintergrund-Tracking |
| Frontend | SvelteKit (Svelte 5, TypeScript), `adapter-static`, Vite PWA Plugin, MapLibre GL JS, Dexie (IndexedDB), uPlot |
| Backend | Node 22 + Fastify 5 (TypeScript), `@fastify/websocket`, Drizzle ORM, pg-boss (Jobs), Nodemailer, `altcha-lib` |
| Datenbank | PostgreSQL 17 + PostGIS, monatlich partitionierte Messtabelle |
| Karte | Protomaps **PMTiles** (DACH-Extrakt) statisch aus Caddy, eigener Schienen-Layer aus OSM (Planetiler), Fonts/Sprites lokal |
| Aggregation | Phase 1: **H3-Hexagone** (Res 8/9), Phase 2: Map-Matching auf OSM-Streckensegmente |
| IP → AS | **iptoasn.com** (Public Domain, stündlich aktualisierbar) als In-Memory-Range-Tabelle im API-Prozess; optional GeoLite2-ASN |
| Auth | Magic Link (Token-Hash, 15 min, Einmalgebrauch, Bestätigungsseite gegen Link-Prefetch), opake Session-Cookies, API-Tokens für CLI/App |
| Reverse Proxy | Caddy 2 (Auto-TLS, Access-Log ohne IP bzw. aus) |
| Mail | Eigener Postfix (sendonly) mit SPF/DKIM/DMARC; Fallback: SMTP-Relay |
| Deployment | Docker Compose auf VPS in Deutschland, pg_dump-Backups, Uptime-Kuma/Grafana optional |
| Repo | pnpm-Monorepo: `apps/web`, `apps/api`, `packages/shared`, `tools/cli` (Go), `infra/` |

## 3. Machbarkeit: Browser/PWA vs. native App

Der kritische Punkt ist **kontinuierliche Standorterfassung im Hintergrund**. Das können Web-Apps nicht;
alles andere (Pings, Speedtest, IP-Check, Live-Stats, Offline-Puffer) geht im Browser problemlos.

| Szenario | Standort | Pings/Upload | Bewertung |
|---|---|---|---|
| Laptop, Browser-Tab sichtbar | Ohne GPS: nur WLAN/IP-basiert, im Zug praktisch unbrauchbar | ja | Position nur über ICE-Portal-API sinnvoll (siehe 6.6), die aber wegen CORS nicht aus der Seite erreichbar ist → Companion-CLI/Extension |
| Laptop, Tab im Hintergrund | wie oben | Timer werden ab 5 min stark gedrosselt (Chrome: 1×/min). **Server-getriebene WebSocket-Pings** umgehen das, weil Message-Handler weiterlaufen | ok für Netzmessung, nicht für Standort |
| Android, PWA im Vordergrund, Display an (Wake Lock) | GPS, `watchPosition`, gut | ja | **funktioniert** |
| Android, PWA im Hintergrund / Display aus | bricht nach Sekunden bis Minuten ab | gedrosselt | nicht zuverlässig → native |
| iOS, PWA/Safari im Vordergrund, Display an (Wake Lock ab iOS 16.4) | GPS, gut | ja | **funktioniert** |
| iOS, Hintergrund | nichts | nichts | native nötig |
| Native App (Capacitor) | Hintergrund-Standort (Android Foreground Service, iOS „Immer“-Berechtigung) | ja | voll |

Konsequenz:

1. **Phase 1 (PWA)** liefert einen **„Fahrt-Modus“**: Bildschirm bleibt an (Screen Wake Lock), dunkle,
   OLED-freundliche Vollbild-Anzeige mit Live-Stats, Handy liegt auf dem Tisch. Das ist für eine
   Zugfahrt akzeptabel (ca. 10–15 % Akku/h) und funktioniert auf iOS und Android identisch.
2. **Phase 2** bringt für Laptop-Nutzer:innen eine **Companion-CLI** (Go, Single Binary), die im ICE
   die Portal-API ausliest (GPS, Geschwindigkeit, Zugnummer, Konnektivitätsstatus) und selbst misst.
3. **Phase 3** verpackt dieselbe Web-App mit **Capacitor** (Android zuerst, dann iOS), ergänzt um
   Hintergrund-Geolocation und nativen HTTP-Zugriff auf die ICE-Portal-API (kein CORS-Problem).
   Flutter/React Native wurden verworfen, weil dann die gesamte Messlogik doppelt existieren würde.

## 4. Architektur

```
 Browser / PWA / Capacitor-App / CLI
   │  HTTPS (JSON, Speedtest-Streams)  │  WSS (Ping/Pong, Zeit-Sync)
   ▼                                   ▼
 ┌────────────────────────── Caddy 2 (TLS, kein IP-Logging) ──────────────────────────┐
 │  /            → statische SvelteKit-PWA                                             │
 │  /tiles/*.pmtiles, /fonts, /sprites → statische Dateien (Range-Requests)            │
 │  /api/*, /ws  → Fastify-API                                                         │
 └─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                     ┌──────────────────┴──────────────────┐
                     │ Fastify-API (Node 22, TypeScript)   │
                     │  • Auth (Magic Link, Sessions, PAT) │
                     │  • Ingest (Batches, Validierung)    │
                     │  • Ping-WS, Speedtest-Endpunkte     │
                     │  • whoami: IP→ASN im RAM, signiert  │
                     │  • Public-Read-API (Zellen, Stats)  │
                     │  • Jobs (pg-boss): Aggregation,     │
                     │    Map-Matching, Retention, ASN-Sync│
                     └──────────────────┬──────────────────┘
                                        │
                     ┌──────────────────┴──────────────────┐
                     │ PostgreSQL 17 + PostGIS             │
                     │  users, sessions, trips, samples(p),│
                     │  cell_stats, segment_stats, asn_*   │
                     └─────────────────────────────────────┘
          Postfix (sendonly)      Offline-Jobs: Planetiler/pmtiles extract (Kartenbau)
```

Grundsatz: Der **Client misst**, der Server validiert, klassifiziert, aggregiert und veröffentlicht.
Der Server erhält Messwerte in Batches, nie Rohdaten wie IPs oder SSIDs.

## 5. Tech-Stack mit Begründung

### Frontend: SvelteKit (Svelte 5, TypeScript)

- Kleine Bundles zählen hier doppelt: Die Seite wird gerade dort geladen, wo das Netz schlecht ist.
- `adapter-static` + Vite PWA Plugin (Workbox): installierbar, offline-fähig, App-Shell gecacht.
- MapLibre GL JS + `pmtiles`-Protokoll für Karte ohne Tile-Server.
- Dexie (IndexedDB) als Offline-Warteschlange für Messwerte.
- uPlot für Sparklines/Live-Charts (klein, schnell).
- ALTCHA-Widget (MIT, keine externen Requests).
- `h3-js` zum Rendern der Hexagone clientseitig aus Zell-IDs (API liefert nur `[cellId, kennzahlen]`, sehr kompakt).
- Web-APIs: Geolocation, Screen Wake Lock, WebSocket, Fetch Streams, Background Sync (Chromium), Network Information (Chromium, nur als Zusatzsignal).

Alternative React/Next.js: funktional gleichwertig, aber schwerer; kein SSR-Bedarf, der Next rechtfertigt.

### Backend: Node 22 + Fastify 5 (TypeScript)

- Eine Sprache im ganzen Stack; `packages/shared` enthält Zod-Schemas, die Web-App, App, CLI-Protokoll
  und API gemeinsam nutzen (Mess-Payloads, Netzklassen, API-Typen).
- Fastify: ausgereiftes WebSocket-Plugin, schnelles Streaming (Speedtest-Downloads aus vorgenerierten
  Zufallsblöcken), Schema-Validierung.
- Drizzle ORM + `postgres.js`, PostGIS über eigene Typen/`sql`-Fragmente.
- pg-boss als Job-Queue in Postgres (kein Redis nötig).
- `altcha-lib` serverseitig für Challenge/Verify.
- Nodemailer → lokaler Postfix.
- IP→ASN: eigener Loader für die iptoasn-TSV (sortierte Ranges, binäre Suche, stündlicher Reload per Job).

Alternative Go (chi + pgx + `altcha-lib-go`): wäre bei den Speedtest-/WS-Endpunkten etwas effizienter.
Für die erwartete Last (Dutzende gleichzeitige Tracker) reicht Node; Entscheidung revidierbar, da die
API hinter einem klar definierten Vertrag steht.

### Datenbank: PostgreSQL 17 + PostGIS

- `samples` monatlich partitioniert (Zeitreihe), Index auf `(trip_id, ts)` und H3-Zellen.
- H3-Zell-IDs werden beim Ingest mit `h3-js` berechnet und als `bigint` gespeichert → Aggregation ist
  normales `GROUP BY`, keine Extension nötig. PostGIS wird für Plausibilität (Abstand zur Schiene) und
  das spätere Map-Matching gebraucht.
- Keine Timescale-Abhängigkeit; native Partitionierung reicht.

### Karte: PMTiles + MapLibre

- Basemap: Protomaps-Build, Ausschnitt Deutschland + Nachbarländer (`pmtiles extract`), eine Datei auf
  der Platte, Caddy liefert Byte-Ranges. Kein Tile-Server, kein Drittanbieter.
- Schienen-Layer: Planetiler (oder Tilemaker) mit Profil nur für `railway=*` aus dem Geofabrik-Extrakt →
  zweite PMTiles-Datei im OpenRailwayMap-Stil. Monatlicher Rebuild.
- Glyphs/Sprites selbst generiert und ausgeliefert.
- Daten-Layer: Phase 1 GeoJSON aus H3-Zellen (clientseitig erzeugt); Phase 2 bei Datenwachstum
  `ST_AsMVT` aus Postgres oder Martin als Tile-Server.

### Infrastruktur

- Docker Compose: `caddy`, `web` (statische Dateien, kann auch Caddy direkt sein), `api`, `postgres`,
  `mail`, optional `uptime-kuma`, `grafana`+`prometheus`.
- VPS in DE (z. B. Hetzner/Netcup), 4 vCPU, 8 GB RAM, 1 Gbit/s. Speedtests kosten Traffic:
  1 000 Tests/Tag × ~50 MB ≈ 1,5 TB/Monat – innerhalb üblicher Inklusivvolumen.
- Backups: nächtlicher `pg_dump` + Off-Site-Kopie (verschlüsselt, z. B. restic).

## 6. Messungen im Detail

### 6.1 Fahrt-Lebenszyklus

1. „Fahrt starten“: Nutzer wählt Zugtyp (ICE / IC/EC / RE/RB / S-Bahn / sonstiges) und optional die
   Zugnummer; Wake Lock aktivieren; Geolocation-Berechtigung (präzise) anfordern; WS verbinden; Zeit-Sync.
2. Laufend: Standort, Pings, periodischer `whoami`, Captive-Portal-Probe, Live-Stats.
3. Auf Knopfdruck: Speedtest (kein Cooldown), optional als Dauer-Speedtest in Schleife.
4. „Fahrt beenden“ oder Auto-Ende nach 30 min ohne Bewegung/ohne GPS.
5. Nachbearbeitung serverseitig: Plausibilität, Netzklasse, H3, Aggregation.

### 6.2 Standort

- `navigator.geolocation.watchPosition({enableHighAccuracy: true, maximumAge: 0})`.
- Gespeichert werden `lat, lon, accuracy_m, speed_mps, heading, ts`. Clientseitig verworfen: `accuracy > 200 m`.
- Serverseitig geprüft: Bounding Box (D-A-CH + Nachbarn), Geschwindigkeit ≤ 350 km/h zwischen Punkten,
  Zeitstempel plausibel (±24 h, mit Clock-Offset korrigiert). Verstoß → Sample `flagged`, nicht veröffentlicht.
- Abstand zur nächsten Schiene (PostGIS KNN auf OSM-Gleisen): > 300 m → `off_rail`, fließt nicht in
  die Heatmap ein (filtert Bahnhofsvorplatz, Bus, Auto).
- Kein Standort im Hintergrund in der PWA (siehe Kapitel 3).

### 6.3 Ping (Latenz, Jitter, Verlust)

Kein ICMP im Browser. Stattdessen:

- Persistente **WebSocket**-Verbindung; der **Server** sendet alle 2 s einen Frame `{seq, t_server}`,
  der Client antwortet sofort mit `{seq, t_client}`. Server-getrieben, damit es auch in gedrosselten
  Hintergrund-Tabs läuft. RTT = Serverzeit zwischen Senden und Antwort (nur eine Uhr beteiligt).
- Verlust: keine Antwort innerhalb 3 s → `lost`. Reconnect-Ereignisse werden als Ausfallfenster protokolliert.
- Jitter: mittlere absolute Abweichung aufeinanderfolgender RTTs (RFC-3550-Stil).
- Zusätzlich alle 30 s ein HTTP-`GET /api/net/probe` (Cache-Buster), um Verbindungsaufbau-Latenz zu messen
  und das Captive Portal zu erkennen (erwarteter exakter Body, sonst `captive=true`).
- **Datenreduktion:** Der Client fasst Pings in **10-s-Fenstern** zusammen (`n, lost, min, median, p90, max,
  jitter`) und lädt nur die Fenster hoch (6 Zeilen/min statt 30). Server speichert die Fenster.
- Verfügbarkeit = Anteil der 10-s-Fenster mit mindestens einer Antwort.

### 6.4 Speedtest

- Manuell (Button) oder optional als Dauer-Speedtest (Tests in Schleife, 5 s Pause dazwischen,
  `SPEEDTEST_CONTINUOUS_PAUSE_MS`). Kein Cooldown, 50 MB je Richtung und Test gedeckelt.
- Download: 4 parallele `fetch`-Streams auf `/api/speed/down?bytes=…`, Server liefert vorgenerierte
  Zufallsblöcke (`Content-Encoding: identity`, Caddy-Kompression für diesen Pfad aus). Messung über
  `ReadableStream`, Dauer 8 s, die erste Sekunde (Ramp-up) wird verworfen.
- Upload: 4 parallele Folgen von POSTs mit Zufallsdaten, Server verwirft Body nach Zählen. 8 s.
  Gezählt werden nur vom Server bestätigte Blöcke (nicht `upload.onprogress` bzw. gelesene Bytes:
  das misst nur Puffer, bei HTTP/2 bis 512 KiB je Stream). Blockgröße adaptiv (`SPEEDTEST_UP_*`,
  Start 256 KiB, 32 KiB–4 MiB, Ziel ~1 s je Block); noch laufende Blöcke zählen nicht (konservativ).
- Ergebnis als `speedtest`-Sample mit `down_bps, up_bps, rtt_idle, rtt_loaded` (Bufferbloat-Indikator).
- Server steht in Deutschland, keine CDN-Anycast-Verfälschung. Gemessen wird bewusst der gesamte Pfad
  inkl. Zug-Backhaul (das ist der Flaschenhals, der die Nutzer:innen interessiert).
- Optional später: Vergleichsmessung gegen einen zweiten Endpunkt.

### 6.5 IP-Check und Netzklassifizierung

- `GET /api/net/whoami`: Server liest die Client-IP aus dem Proxy-Header, schlägt im **RAM** die ASN nach,
  antwortet mit `{asn, as_name, net_class, ip_version, exp, sig}` und **vergisst die IP**. Die Antwort ist
  HMAC-signiert (5 min gültig).
- Der Client hängt das signierte Token an alle Samples des Zeitraums. Grund: Messwerte werden offline
  gepuffert und evtl. später über ein anderes Netz hochgeladen; die Netzklasse muss zum Messzeitpunkt
  passen und darf nicht fälschbar sein.
- Klassen: `db_wlan`, `mobile_telekom`, `mobile_vodafone`, `mobile_o2`, `mobile_other`, `vpn_hosting`,
  `unknown`. Tethering über das eigene Handy zählt korrekt als Mobilfunk.
- Zuordnung ASN → Klasse in einer kuratierten Tabelle `asn_catalog` (Seed: bekannte Carrier-ASNs,
  Hosting-/VPN-Listen). Unbekannte ASNs landen in einer Admin-Review-Queue.
- **Offener Punkt / Phase 0:** Über welche ASN das WIFIonICE-Backhaul (Icomera, Multi-Carrier-Bündelung)
  tatsächlich ausgeht, muss empirisch auf Probefahrten festgestellt werden. Zusatzsignale: Captive-Portal-
  Erkennung, Netzwerk-API `type=wifi` (nur Chromium/Android), in der App/CLI die Erreichbarkeit von
  `iceportal.de`. Die endgültige Klasse ist eine Kombination dieser Signale mit Konfidenzwert.
- VPN-Nutzer:innen werden als `vpn_hosting` erkannt und aus den Provider-Vergleichen ausgeschlossen (bleiben in „alle“).
- Gespeichert werden ausschließlich `asn`, `net_class`, `ip_version`. Keine IP, auch kein Hash
  (IPv4-Hashes sind trivial umkehrbar).

### 6.6 ICE-Portal-API (nur App/CLI)

Im WIFIonICE liefert `https://iceportal.de/api1/rs/status` (inoffiziell, Stand prüfen) u. a. GPS-Position,
Geschwindigkeit, `connectivity.currentState` (HIGH/MIDDLE/LOW/UNSTABLE/NO_INFO) und Zugnummer;
`/api1/rs/tripInfo/trip` den Fahrplan mit nächsten Halten. Das ist Gold für Laptop-Nutzer:innen ohne GPS
und für die Zuordnung zu Zügen/Linien. Aus einer Webseite ist das wegen fehlender CORS-Header nicht
abrufbar, in der Capacitor-App (CapacitorHttp) und der Go-CLI schon. Regio-Portale (WIFI@DB, regionale
Betreiber) sind heterogen und werden einzeln evaluiert.

### 6.7 Zeit-Synchronisation

Beim WS-Aufbau NTP-ähnlicher Austausch (t0..t3) → `clock_offset_ms` pro Fahrt; Server speichert
Client-Zeitstempel plus Offset. Verhindert, dass falsch gestellte Handy-Uhren Fahrten verschieben.

### 6.8 Offline-Puffer und Upload

- Alle Samples zuerst in IndexedDB (Dexie), Upload in Batches (≤ 500 Zeilen oder 30 s), idempotent über
  client-generierte UUIDs. Bei Fehlern Exponential-Backoff; Background Sync wo verfügbar.
- Batches werden mit `Content-Encoding: gzip` (CompressionStream) gesendet – im Zug zählt jedes Byte.
- Fahrt lässt sich beenden, obwohl noch Daten im Puffer sind; Upload läuft beim nächsten Öffnen weiter.

### 6.9 Live-Stats (Fahrt-Modus)

Große Zahlen auf dunklem Hintergrund: aktuelle RTT mit Sparkline (letzte 5 min), Jitter, Verlust %,
Verfügbarkeit der Fahrt, Geschwindigkeit (GPS), Netzklasse/Provider, Captive-Portal-Warnung mit Link
zum Portal, Puffer-/Upload-Status, GPS-Genauigkeit, letzter Speedtest, Akku-Hinweis.

## 7. Datenmodell (Kern)

```
users            id, email (lowercase, unique), display_name (unique, änderbar), created_at,
                 role (user|admin), deleted_at, settings jsonb (leaderboard_opt_in, …)
sessions         id_hash, user_id, created_at, expires_at, last_seen_at, label (coarse: "iOS PWA")
magic_links      token_hash, email, created_at, expires_at, consumed_at
api_tokens       token_hash, user_id, name, created_at, last_used_at, revoked_at   -- für CLI/App
trips            id, user_id, device_label, train_type, train_number?, started_at, ended_at,
                 clock_offset_ms, client_platform, status (active|ended|flagged|deleted)
samples (part.)  id (client uuid), trip_id, ts, kind (ping_window|speedtest|probe|location),
                 geom Point(4326)?, accuracy_m, speed_mps, h3_r8, h3_r9,
                 rtt_min/median/p90/max, jitter_ms, n, lost, down_bps, up_bps, rtt_loaded,
                 captive bool, asn int, net_class, net_confidence, ip_version,
                 ice_state?, flags (off_rail|implausible|…), created_at
asn_catalog      asn, name, country, net_class, source, reviewed_at
asn_ranges       nur im RAM (aus iptoasn-TSV), nicht in der DB
cell_stats       h3 cell, resolution, period (day|7d|30d|all), net_class, train_type,
                 n_samples, n_trips, rtt_median, rtt_p90, loss_pct, availability_pct,
                 down_median, up_median, updated_at
rail_segments    (Phase 2) id, osm_ref, line_name, geom LineString, length_m
segment_stats    (Phase 2) wie cell_stats, aber je Segment
```

Aufbewahrung: Roh-Samples 12 Monate, danach nur noch Aggregate. Fahrten/Samples eines gelöschten Kontos
werden sofort gelöscht; die bereits eingeflossenen Aggregate werden beim nächsten Lauf neu berechnet.

## 8. API-Skizze

```
POST /api/auth/magic-link          {email, altcha}            → 204 (immer, auch bei unbekannter Mail)
GET  /auth/confirm?token=…         Bestätigungsseite (kein Auto-Login, s. 9.1)
POST /api/auth/confirm             {token}                    → Set-Cookie
POST /api/auth/logout | /logout-all
GET  /api/me · PATCH /api/me {display_name, settings} (ALTCHA bei Namensänderung)
DELETE /api/me                     Kontolöschung (Bestätigung per Mail)
GET  /api/me/export                JSON + GPX aller eigenen Fahrten
POST /api/tokens · DELETE /api/tokens/:id

POST /api/trips                    {train_type, train_number?, platform}
POST /api/trips/:id/samples        gzip-Batch, idempotent
POST /api/trips/:id/end
GET  /api/trips (eigene) · GET /api/trips/:id

GET  /api/net/whoami               {asn, as_name, net_class, ip_version, exp, sig}
GET  /api/net/probe                Captive-Portal-Probe, fester Body
WS   /ws                           Zeit-Sync + server-getriebene Pings
GET  /api/speed/down?bytes=        Zufallsdaten-Stream (Quota)
POST /api/speed/up                 Body zählen und verwerfen (Quota)

GET  /api/public/cells?res=8&bbox=…&metric=…&net=…&period=…&train=…
GET  /api/public/cells/:h3         Detail (Verteilungen, n, letzte Aktualisierung)
GET  /api/public/stats             Gesamtübersicht je Provider/Zugtyp
GET  /api/public/leaderboard       nur Opt-in, nur Zähler
GET  /api/public/live              Anzahl aktiver Fahrten (keine Positionen)
```

Alle Endpunkte mit Zod-Schemas aus `packages/shared`; Fehler als RFC 9457 Problem Details.

## 9. Auth und Sicherheit

### 9.1 Magic Link

- 32 Byte Zufall, in der DB nur SHA-256, 15 min gültig, einmalig.
- Der Link führt auf eine **Bestätigungsseite mit Button** („Anmeldung bestätigen“ → POST). Mail-Scanner und
  Link-Vorschauen verbrauchen den Token dann nicht; zusätzlich schützt es vor Login-CSRF über fremde Links.
- Antwort auf die Anforderung ist immer identisch (kein Nutzer-Enumeration).
- ALTCHA-Proof-of-Work vor jeder Anforderung; zusätzlich Limit je E-Mail (z. B. 3/h) und globales Limit.
- Mails: Plaintext + HTML, kein Tracking, Absender mit SPF/DKIM/DMARC.

### 9.2 Sessions und Tokens

- Opakes Session-Token (32 Byte) im Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, 90 Tage gleitend,
  DB speichert nur den Hash. „Überall abmelden“ löscht alle Sessions.
- CSRF: Cookies `SameSite=Lax` + Prüfung von `Origin`/`Sec-Fetch-Site` auf allen mutierenden Requests.
- API-Tokens (Bearer) für CLI/App, in der Web-UI erzeugbar/widerrufbar, nur Hash gespeichert.

### 9.3 ALTCHA

Self-hosted PoW-Captcha ohne externe Requests. Einsatz: Magic-Link-Anforderung, Namensänderung,
Kontolöschung, Token-Erstellung. Schwierigkeit adaptiv (höher bei globaler Last). Challenges serverseitig
mit Ablauf und Einmal-Verwendung (Replay-Schutz).

### 9.4 Rate Limits ohne IPs

- Primär **pro Nutzer/Session**: Samples/min, Speedtests (1/2 min), Mails/h, Token-Erzeugung.
- Anonyme Endpunkte (`whoami`, `probe`, Magic-Link) sind billig und/oder ALTCHA-geschützt.
- Falls ein grobes Verbindungs-Limit am Proxy nötig wird: Caddy `rate_limit` arbeitet rein im RAM mit
  kurzen Fenstern; das wird in der Datenschutzerklärung als flüchtige Verarbeitung dokumentiert.

### 9.5 Validierung und Missbrauch

- Strikte Schemas, Größenlimits, Idempotenz über UUIDs.
- Plausibilitätsprüfungen (Kap. 6.2), Netzklasse nur über signierte `whoami`-Tokens.
- Statistische Robustheit: Mediane/Perzentile statt Mittelwerte, Zellen erst ab `n_trips ≥ 3`.
- Admin-Werkzeuge: Fahrt/Nutzer sperren (Shadow-Flag, Daten aus Aggregaten entfernen), ASN-Review-Queue.

### 9.6 Härtung

- Strikte CSP (`default-src 'self'`, keine Inline-Skripte, `connect-src 'self'`), HSTS, `Permissions-Policy`
  (Geolocation nur self), `Referrer-Policy: same-origin`, COOP/CORP.
- Keine Third-Party-Assets. Dependabot/Renovate, `npm audit` in CI, Container als non-root, read-only FS.
- Secrets über Env/Compose-Secrets; DB nur im internen Netz.

## 10. Datenschutz

- **IP-Adressen:** Nur im RAM für ASN-Lookup und Verbindungsabwicklung. Keine Persistenz, kein Hash. Caddy-
  Access-Log aus oder `remote_ip` per Log-Filter entfernt; Fastify-Logger ohne `req.ip`/Header; Postgres
  loggt keine Clientdaten; Fehler-Tracking (falls GlitchTip) mit IP-Scrubbing. Das ist ein Grund für
  Self-Hosting ohne Cloudflare/CDN.
- **Bewegungsprofile:** Einzelne Fahrten sind **privat** (nur für die Person selbst sichtbar). Öffentlich sind
  nur Aggregate je Zelle/Segment mit **k-Anonymität** (`n_trips ≥ 3`) und **Verzögerung** (frühestens
  60 min nach Messung, Standard: tägliche Aggregation). Die Live-Ansicht zeigt nur Zähler, keine Positionen.
- Öffentlicher Name erscheint nur in der Opt-in-Rangliste (Anzahl Fahrten/Messungen), nie an Orten/Zeiten.
- Konto löschen (sofort, inkl. Samples), Export (JSON/GPX), Einwilligungstexte, Datenschutzerklärung,
  Impressum, AV-Vertrag mit dem Hoster, Verzeichnis der Verarbeitungstätigkeiten.
- Aufbewahrung: Roh-Samples 12 Monate, Sessions 90 Tage, Magic-Link-Tokens 24 h, Mails nicht archiviert.
- Rechtsgrundlage: Vertrag (Konto) bzw. Einwilligung (Standort, Rangliste). Keine Analytics außer eigenen,
  aggregierten Zählern (z. B. Plausible wäre möglich, aber nicht nötig).

## 11. Karte und Auswertung

### 11.1 Öffentliche Karte

- MapLibre, Basemap gedämpft, Schienen-Layer prominent, Daten-Layer als H3-Hexagone (Res 8 ≈ 460 m Kante
  für Übersicht, Res 9 ≈ 174 m beim Hineinzoomen).
- Metrik umschaltbar: Latenz (Median), Verlust, Verfügbarkeit, Download, Upload. Farbskala sequentiell,
  „keine Daten“ grau, Zellen mit zu wenig Fahrten ausgeblendet.
- Filter: Netzklasse (DB-WLAN / Mobilfunk je Carrier / alle), Zeitraum (7 / 30 / 365 Tage), Zugtyp.
- Klick auf Zelle: n Fahrten/Messungen, Verteilung, letzte Aktualisierung, Vergleich der Netzklassen.
- Kompakte Antworten: `[h3, n, rtt, loss, avail, down, up]`-Arrays, clientseitiges Rendering.

### 11.2 Streckenbezogene Auswertung (Phase 2)

- OSM-Gleise (Geofabrik-Extrakt, `railway=rail` + `route=train`-Relationen) → `rail_segments`
  (z. B. 1-km-Abschnitte entlang jeder Strecke, mit Streckenname/Linienreferenz).
- Map-Matching: Sample → nächstes Segment (PostGIS KNN, Richtungs-/Geschwindigkeitsplausibilität).
- Auswertungen: „Schlechteste Abschnitte“, Strecken-Profil (Latenz über Kilometer), Vergleich DB-WLAN vs.
  Mobilfunk je Strecke, Zugtyp-Vergleich, Tagesgang.

### 11.3 Statistik-Seiten

Gesamtzahlen, Provider-Vergleich (Median/p90), Verfügbarkeit je Zugtyp, Trend über Monate, Opt-in-Rangliste.
Alles aus `cell_stats`/`segment_stats`, nie aus Rohdaten einzelner Fahrten.

## 12. Betrieb

- `infra/compose.yml` mit Caddy, API, Postgres, Postfix, optional Monitoring; `.env.example`.
- Kartenbau als separates Skript (`infra/tiles/build.sh`): Geofabrik-Download → Planetiler → PMTiles;
  Protomaps-Extrakt per `pmtiles extract`. Läuft monatlich per Cron, Dateien atomar austauschen.
- ASN-Daten: stündlicher Download der iptoasn-TSV in den API-Prozess (nur RAM, Fallback letzte Datei).
- Backups: nächtlich `pg_dump` + restic Off-Site; Restore-Test quartalsweise.
- Monitoring: Health-Endpunkt, Uptime-Kuma, optional Prometheus-Metriken der API (ohne IPs).
- CI: Lint, Typecheck, Tests (Vitest, Playwright für Fahrt-Modus-Flow), Docker-Build.

Datenmengen-Abschätzung: 100 aktive Tracker × 3 h/Tag × 6 Fenster/min ≈ 108 000 Zeilen/Tag ≈ 40 Mio./Jahr
≈ 10–15 GB inkl. Indizes. Unkritisch.

## 13. Roadmap

**Phase 0 – Grundlagen (1–2 Wochen)**
Domain, VPS, Mail-Setup (SPF/DKIM/DMARC), Repo-Gerüst, CI, Kartenbau einmal durchlaufen,
2–3 Probefahrten mit einfachem Skript zur Erfassung der ASNs von WIFIonICE/Regio-WLAN und zur Prüfung der
ICE-Portal-API. Rechtstexte beauftragen/entwerfen.

**Phase 1 – MVP PWA (4–6 Wochen)**
Magic-Link-Auth mit ALTCHA, Profil/Name, Fahrt-Modus (Standort, WS-Pings, 10-s-Fenster, whoami,
Captive-Probe, Speedtest, Live-Stats, Offline-Puffer), Ingest mit Validierung, H3-Aggregation,
öffentliche Karte mit Filtern, Statistik-Grundseite, Export/Löschung, Datenschutz/Impressum.

**Phase 2 – Tiefe (4 Wochen)**
Go-CLI für Laptops (ICE-Portal, Pings, Speedtest, Upload per API-Token), Map-Matching auf Streckensegmente,
Streckenprofile und „schlechteste Abschnitte“, Admin-Moderation und ASN-Review, Opt-in-Rangliste.

**Phase 3 – Native (4–6 Wochen)**
Capacitor-Wrapper: Android zuerst (APK/F-Droid/Play), Hintergrund-Geolocation (Foreground Service),
nativer Zugriff auf ICE-Portal-API, dann iOS (Always-Location, Store-Review-Begründung). Browser-Extension
für ICE-Portal-Zugriff am Laptop als kleine Zusatzoption.

## 14. Offene Fragen und Risiken

1. **ASN des DB-WLAN**: Erst nach Probefahrten klar, ob Icomera oder ein Carrier als Ausgang erscheint.
   Ohne saubere Klassifizierung ist der Kernvergleich wertlos → Phase 0 priorisieren.
2. **Akku/UX im Fahrt-Modus**: Display-an-Zwang in der PWA. Mitigation: Dunkelmodus, Helligkeits-Hinweis,
   klarer Hinweis auf spätere App.
3. **Mail-Zustellbarkeit** bei eigenem Postfix (Reputation neuer IPs). Mitigation: saubere DNS-Einträge,
   geringes Volumen, Relay als Fallback.
4. **Datenqualität**: wenige Nutzer:innen am Anfang → viele leere Zellen. Mitigation: Zellen erst ab
   `n_trips ≥ 3` zeigen, Zeitraumfilter weit, Community-Aufruf.
5. **ICE-Portal-API** ist inoffiziell und kann sich ändern → nur als Zusatzsignal, nie als Pflicht.
6. **Hetzner/VPS-Traffic** bei viralem Wachstum → Speedtest-Quota ist der Regler.
7. **iOS-Store-Review** für Hintergrund-Standort → Begründung vorbereiten, alternativ TestFlight.
8. **Datenschutz-Rest-Risiko** bei dünn besiedelten Zellen trotz k-Anonymität → Verzögerung + Mindest-n,
   bei Bedarf Zellauflösung in ländlichen Gebieten gröber.

## 15. Repo-Struktur

```
apps/web          SvelteKit-PWA (Tracker, Karte, Konto)
apps/api          Fastify-API, Jobs, Mail, ASN-Loader
packages/shared   Zod-Schemas, Typen, Netzklassen, Konstanten
tools/cli         Go-Companion (Phase 2)
infra/            compose.yml, Caddyfile, tiles/build.sh, Backup-Skripte
docs/             PLANUNG.md (dieses Dokument), ADRs, Datenschutz-Entwürfe
```
