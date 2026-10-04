# BahnPing (Bahn-Netzwerk-Tracker) – Hinweise für Claude Code

Planung: `docs/PLANUNG.md`. API-Vertrag: `docs/API.md`. Geteilte Schemas: `packages/shared/src`.

## Struktur
- `apps/web` SvelteKit 3 / Svelte 5 (Runes), `adapter-static` mit SPA-Fallback, baut nach `apps/web/build`.
- `apps/api` Fastify 5 + Drizzle (Postgres/PostGIS). Liefert in der Testversion auch `apps/web/build`, `/mailpit` (Proxy) und `/tiles` aus.
- `packages/shared` Zod-Schemas, Konstanten, Netzklassen. Nach Änderungen `pnpm --filter @bahn/shared build`.
- `infra/dev/compose.yml` Postgres (127.0.0.1:4132) und Mailpit (SMTP 4125, UI 4126, Webroot `/mailpit`).
- `infra/tiles/data` PMTiles-Basemap, Fonts, Sprites (nicht im Git).

## Befehle
- `scripts/dev-up.sh` – Testversion komplett starten (Port 4100), `scripts/dev-down.sh` – stoppen.
- `pnpm dev:api` (tsx watch), `pnpm dev:web` (Vite 4173 mit Proxy auf 4100).
- `pnpm -r typecheck`, in `apps/api`: `pnpm db:generate` nach Schemaänderungen.

## Regeln
- Niemals IP-Adressen speichern, loggen oder hashen. Keine `req.ip` in Logs. Nur ASN, Netzklasse, IP-Version.
- Keine externen Requests aus dem Browser (keine CDNs, Fonts, Tiles von Dritten).
- UI-Texte auf Deutsch. Code-Kommentare auf Deutsch, Bezeichner auf Englisch.
- Ports dieses Projekts: 41xx. Ports 80/443/1025/8025/3000/8080 gehören einem anderen Projekt auf dieser Maschine.
- Validierung immer über die Zod-Schemas aus `@bahn/shared`, Fehler als RFC 9457 Problem Details.
