# BahnPing

Misst, wie gut das Netz in Zügen tatsächlich ist – getrennt nach **DB-WLAN** und **eigenem Mobilfunk** –
und veröffentlicht das Ergebnis als Karte entlang der Strecken. Während einer Fahrt werden Latenz,
Paketverlust, Standort, der Status des ICE-Portals und auf Wunsch der Durchsatz erfasst.

*English summary below.*

## Datenschutz

- IP-Adressen werden **nie** gespeichert, geloggt oder gehasht. Sie werden nur im Arbeitsspeicher für die
  Zuordnung zum Netzbetreiber (ASN) genutzt.
- Komplett selbst gehostet: Karte (PMTiles), Schriften, Captcha (ALTCHA), Mail. Der Browser spricht keine
  Drittanbieter an.
- Solange die Datenbasis klein ist, ist alles sofort öffentlich: Karte ohne Mindestanzahl an Fahrten,
  einzelne Fahrten mit Strecke und Zeitpunkten (Liste auf `/stats`), aber ohne Namen oder Konto. Die
  Positionen liegen ohnehin auf den Gleisen. Später wieder Aggregate mit `PUBLIC_MIN_TRIPS > 1`.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `apps/web` | SvelteKit (Svelte 5), PWA mit Fahrt-Modus, Karte (MapLibre), Diagramme (uPlot), Deutsch/Englisch, Hell/Dunkel |
| `apps/api` | Fastify 5, Drizzle ORM, PostgreSQL/PostGIS, WebSocket-Pings, Magic-Link-Login |
| `packages/shared` | Zod-Schemas, Konstanten, Netzklassen (geteilt von Web und API) |
| `tools/cli` | Companion-CLI in Go für Laptops: liest im ICE das Bordportal (GPS, Tempo, Zugnummer, Verbindungsstatus) |
| `infra` | Docker Compose für Postgres und Mailpit (Entwicklung), Kachel-Daten |
| `docs` | [Planung](docs/PLANUNG.md), [API-Vertrag](docs/API.md), [CLI](docs/CLI.md) |

## Schnellstart (Entwicklung)

Voraussetzungen: Node 22, pnpm, Docker. Für die CLI zusätzlich Go.

```sh
pnpm install
cp .env.example .env              # Werte anpassen, APP_SECRET neu erzeugen!
scripts/dev-up.sh                 # Postgres + Mailpit starten, Web bauen, API auf Port 4100 starten
```

Danach läuft alles unter <http://localhost:4100>. Login-Mails landen in Mailpit unter `/mailpit`.

Für die Arbeit an der Oberfläche: `pnpm dev:api` und `pnpm dev:web` (Vite auf Port 4173 mit Proxy auf die API).

Die Basiskarte (`infra/tiles/data`: PMTiles, Fonts, Sprites) ist nicht im Repository und muss separat
abgelegt werden, z.B. ein Protomaps-Extrakt für die DACH-Region.

Nützliche Befehle:

```sh
pnpm -r typecheck                       # Typprüfung aller Pakete
pnpm --filter @bahn/shared build        # nach Änderungen an packages/shared
pnpm --filter @bahn/api db:generate     # Migration nach Schemaänderungen
scripts/build-cli.sh                    # CLI-Binaries bauen
```

## Produktion

- `NODE_ENV=production` und ein eigenes, zufälliges `APP_SECRET` (mind. 32 Zeichen, z.B.
  `openssl rand -base64 48`) setzen. Mit dem Beispielwert startet die API in Produktion nicht.
- `PUBLIC_URL` auf die öffentliche Adresse, `TRUST_PROXY` auf den Reverse Proxy setzen.
- `PUBLIC_MIN_TRIPS` (Mindestanzahl Fahrten je Kartenzelle) in Produktion auf mindestens 3.

---

## English summary

BahnPing measures how good connectivity on German trains really is, separating **DB Wi-Fi** from **your
own mobile network**, and publishes the results as a map along the railway lines. During a trip it records
latency, packet loss, position, the ICE onboard portal status and, on request, throughput.

- **Privacy first:** IP addresses are never stored, logged or hashed; only the ASN, network class and IP
  version are kept. Everything is self-hosted (map tiles, fonts, captcha, mail), so the browser never talks
  to third parties.
- **Stack:** SvelteKit/Svelte 5 PWA, Fastify 5 + Drizzle + PostgreSQL/PostGIS, shared Zod schemas and a
  Go companion CLI for laptops.
- **Getting started:** `pnpm install`, copy `.env.example` to `.env` (generate a fresh `APP_SECRET`), then
  run `scripts/dev-up.sh` and open <http://localhost:4100>.

The UI is available in German and English. Code comments and project docs are in German.

## Lizenz / Licence

[GNU Affero General Public License v3.0](LICENSE). Wer eine veränderte Version öffentlich als Dienst
betreibt, muss den Quellcode dieser Version ebenfalls veröffentlichen.
