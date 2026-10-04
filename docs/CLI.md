# bahnping – Companion-CLI

> **Umbenennung:** Die CLI hieß früher `bahnnet`. Beim ersten Start übernimmt `bahnping` die alte
> Konfiguration (`~/.config/bahnnet`) und gepufferte Messungen (`~/.local/state/bahnnet`) automatisch und
> stellt die Serveradresse von `bahnnet.treudler.net` auf `bahnping.treudler.net` um.

Go-Kommandozeilenwerkzeug für Laptops ohne GPS im Zug (siehe PLANUNG.md Kapitel 3 und 6.6).
Es misst dasselbe wie der Browser-Client (Ping-Fenster, Speedtest, `whoami`/`probe`) und sendet
exakt dieselben Payloads (`packages/shared/src/schemas.ts`), ergänzt die Position aber – falls
erreichbar – über die inoffizielle ICE-Portal-API (`https://iceportal.de`, nur im WIFIonICE).

Quellcode: `tools/cli` (eigenes Go-Modul `github.com/treudler/bahnping-cli`, Go 1.27).
Build: `scripts/build-cli.sh` (siehe unten).

## Installation

Vorgebaute Binaries liegen unter `/dl/bahnping-<os>-<arch>` auf dem Server (z.B.
`bahnping-darwin-arm64` für Apple-Silicon-Macs, `bahnping-darwin-amd64` für Intel-Macs,
`bahnping-linux-amd64`/`bahnping-linux-arm64` für Linux).

```sh
curl -fsSL https://<dein-server>/dl/bahnping-darwin-arm64 -o bahnping
chmod +x bahnping
```

**macOS-Quarantäne:** Bitte nicht über einen Browser herunterladen – macOS markiert so
heruntergeladene Dateien als "nicht verifizierter Entwickler" (Gatekeeper-Quarantäne) und
verweigert die Ausführung. Der `curl`-Weg oben setzt dieses Attribut nicht. Falls die Datei
trotzdem blockiert wird (z.B. weil sie über AirDrop/Browser kam):

```sh
xattr -d com.apple.quarantine bahnping
```

Danach `./bahnping version` zum Test, und am besten ins `PATH` legen, z.B.
`mv bahnping /usr/local/bin/bahnping` oder `~/bin/bahnping`.

## Anmeldung

1. Im Web unter **Konto → API-Tokens** ein neues Token anlegen (Format `bnt_…`, wird nur einmal
   angezeigt).
2. In der CLI anmelden:

```sh
bahnping login https://<dein-server>
# API-Token: <hier das bnt_...-Token einfügen, wird nicht angezeigt>
```

Die Konfiguration (Server-URL + Token) liegt danach unter
`$XDG_CONFIG_HOME/bahnping/config.json` bzw. `~/.config/bahnping/config.json` mit Zugriffsrechten
`0600`.

```sh
bahnping whoami   # Konto- und Netzinformationen (ASN, AS-Name, Netzklasse, IP-Version)
bahnping logout   # Lokale Anmeldung entfernen
```

## Fahrt starten

```sh
bahnping track
```

Optionen:

| Flag | Bedeutung |
|---|---|
| `--train ice\|ic\|regio\|sbahn\|other` | Zugtyp. Ohne Angabe wird er aus dem ICE-Portal übernommen, sonst interaktiv abgefragt. |
| `--number "ICE 599"` | Zugnummer. Ohne Angabe wird sie, falls möglich, aus dem ICE-Portal nachgetragen. |
| `--speedtest-every 10m` | Automatischer Speedtest in diesem Abstand (sonst nur per Taste `s`). |
| `--no-position` | Keine Position senden, auch wenn das ICE-Portal erreichbar ist (immer `posSource=none`). |
| `--iceportal-url https://iceportal.de` | Andere ICE-Portal-Basis-URL, z.B. für Tests mit einem Mock-Server. |
| `--plain` | Eine Log-Zeile pro 10-Sekunden-Fenster statt der Live-Ansicht (für Logs/`screen`/`tmux`). |
| `--debug` | Rohantworten des ICE-Portals (einmalig) und WS-Verbindungsereignisse ausgeben. |

In der Live-Ansicht:

- **`s`** löst sofort einen Speedtest aus (Download/Upload, je 8 s, gedeckelt wie im Browser:
  höchstens 1 Test pro 2 Minuten serverseitig).
- **`q`** oder Ctrl-C beendet die Fahrt: letztes Mess-Fenster wird abgeschlossen, die lokale
  Warteschlange so weit wie möglich hochgeladen, dann `POST /api/trips/:id/end` gesendet.

## Was gemessen wird

- **Ping-Fenster** (alle 10 s): RTT min/median/p90/max, Jitter, Verlust – über die server-getriebenen
  WebSocket-Pings (`/ws`), exakt wie im Browser (`PING_INTERVAL_MS`/`WINDOW_MS` aus
  `packages/shared`).
- **Captive-Portal-Probe** (alle 30 s): `GET /api/net/probe`.
- **Netzklasse** (alle 60 s): `GET /api/net/whoami`, signiertes Token wird an alle Samples der
  Gültigkeitsdauer angehängt.
- **Position**: aus der ICE-Portal-API (`GET /api1/rs/status`), wenn diese erreichbar ist und der
  letzte erfolgreiche Abruf jünger als 15 s ist; sonst `posSource=none` (keine Position, auch kein
  GPS – das kann die CLI auf einem Laptop nicht).
- **Speedtest**: auf Tastendruck oder per `--speedtest-every`, 4 parallele Download-/Upload-Streams,
  je 8 s, erste Sekunde verworfen.

Alle Messungen werden zunächst in eine lokale Datei
(`~/.local/state/bahnping/outbox-<fahrt-id>.jsonl`) geschrieben und von dort in Batches
(≤ 500 Zeilen, alle 30 s oder ab 100 gepufferten Einträgen) hochgeladen. Bricht die CLI ab
(Absturz, Verbindungsabbruch, Akku leer), sendet der nächste `bahnping track`-Lauf übrig
gebliebene Dateien automatisch nach.

## Grenzen

- **Ohne ICE-Portal keine Position.** Die CLI hat kein GPS; außerhalb des WIFIonICE (oder wenn
  `iceportal.de` aus einem anderen Grund nicht erreichbar ist) werden alle Samples ohne Position
  gesendet (`posSource=none`). Das ist für Netzmessungen kein Problem, nur für die spätere
  Kartendarstellung dieser Fahrt.
- **Regionalzug-Portale werden noch nicht unterstützt.** WIFI@DB/regionale WLAN-Portale haben
  andere, bisher nicht ausgewertete APIs (siehe PLANUNG.md 6.6). `--iceportal-url` zeigt in diesen
  Netzen typischerweise auf nichts Erreichbares; die CLI misst dann weiter, nur ohne Position.
- Die ICE-Portal-API ist inoffiziell und kann sich jederzeit ändern; die CLI parst alle Felder
  defensiv (fehlende/als String kodierte Werte führen nicht zum Absturz).

## Build

```sh
scripts/build-cli.sh
```

Baut `CGO_ENABLED=0`, `-trimpath`, `-ldflags "-s -w -X main.version=<git describe>"` nach
`.run/dist/`:

- `bahnping-darwin-arm64`
- `bahnping-darwin-amd64`
- `bahnping-linux-amd64`
- `bahnping-linux-arm64`

Das Skript führt vorher `go vet`/`go test` über `tools/cli` aus. `.run/dist/` wird später unter
`/dl/` ausgeliefert (Caddy, statisches Verzeichnis).

## Entwicklung / Tests

```sh
cd tools/cli
go vet ./...
go test ./...
```

Unit-Tests decken ab: Ping-Fenster-Statistik (Median/P90/Jitter/Verlust, `internal/stats`),
die Outbox-Datei (Anhängen, Entfernen, Neustart-Persistenz, `internal/outbox`) und das defensive
ICE-Portal-Parsing mit aufgezeichneten Beispiel-JSONs inkl. Zahlen-als-String und `null`-Feldern
(`internal/iceportal`).

Für einen Integrationstest gegen eine laufende API (`scripts/dev-up.sh`) und einen lokalen
ICE-Portal-Mock:

```sh
go run ./cmd/bahnping track --iceportal-url http://127.0.0.1:<mock-port> --plain --debug
```
