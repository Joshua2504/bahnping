// bahnping ist die Companion-CLI für bahn-netzwerk-tracker (siehe docs/CLI.md).
// Sie misst auf Laptops ohne GPS im Zug, gestützt auf die inoffizielle ICE-Portal-API
// für die Position, und sendet dieselben Payloads wie der Browser-Client
// (packages/shared/src/schemas.ts).
package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/treudler/bahnping-cli/internal/apiclient"
	"github.com/treudler/bahnping-cli/internal/config"
	"golang.org/x/term"
)

// version wird beim Build per -ldflags "-X main.version=<git describe>" gesetzt
// (siehe scripts/build-cli.sh); im Entwicklungsbuild bleibt es "dev".
var version = "dev"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}
	cmd := os.Args[1]
	args := os.Args[2:]
	var err error
	switch cmd {
	case "login":
		err = cmdLogin(args)
	case "logout":
		err = cmdLogout(args)
	case "whoami":
		err = cmdWhoami(args)
	case "track":
		err = cmdTrack(args)
	case "diag":
		err = cmdDiag(args)
	case "version", "-v", "--version":
		fmt.Printf("bahnping %s\n", version)
	case "help", "-h", "--help":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unbekannter Befehl %q\n\n", cmd)
		printUsage()
		os.Exit(1)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "Fehler: %v\n", err)
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprint(os.Stderr, `bahnping – Companion-CLI für bahn-netzwerk-tracker

Verwendung:
  bahnping login <server-url>   Bei einem Server anmelden (API-Token wird abgefragt)
  bahnping logout               Lokale Anmeldung entfernen
  bahnping diag                 ICE-Portal und Zug-WLAN-Endpunkte prüfen (Diagnose)
  bahnping whoami                Konto- und Netzinformationen anzeigen
  bahnping track [optionen]      Fahrt starten und messen
  bahnping version               Version anzeigen

Optionen für "track":
  --train ice|ic|regio|sbahn|other   Zugtyp (sonst ICE-Portal oder interaktive Auswahl)
  --number "ICE 599"                  Zugnummer (sonst ICE-Portal, falls verfügbar)
  --speedtest-every 10m               Automatischer Speedtest in diesem Abstand
  --no-position                       Keine Position senden (immer posSource=none)
  --iceportal-url https://iceportal.de ICE-Portal-Basis-URL (für Tests mit Mock)
  --plain                             Eine Log-Zeile pro Fenster statt Live-Ansicht
  --debug                             Rohantworten/Verbindungsdetails ausgeben

Siehe docs/CLI.md für Details.
`)
}

func cmdLogin(args []string) error {
	if len(args) < 1 || strings.HasPrefix(args[0], "-") {
		return fmt.Errorf("Verwendung: bahnping login <server-url>")
	}
	serverURL := strings.TrimRight(args[0], "/")

	fmt.Println("API-Token im Web unter Konto -> API-Tokens anlegen (Format \"bnt_...\").")
	fmt.Print("API-Token: ")
	token, err := readSecret()
	if err != nil {
		return fmt.Errorf("Token konnte nicht gelesen werden: %w", err)
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("leeres Token")
	}

	client := apiclient.New(serverURL, token)
	me, err := client.Me(context.Background())
	if err != nil {
		return fmt.Errorf("Token konnte nicht verifiziert werden (%s/api/me): %w", serverURL, err)
	}

	if err := config.Save(&config.Config{Server: serverURL, Token: token}); err != nil {
		return err
	}
	name := me.Email
	if me.DisplayName != nil && *me.DisplayName != "" {
		name = *me.DisplayName
	}
	fmt.Printf("Angemeldet als %s bei %s.\n", name, serverURL)
	return nil
}

// readSecret liest eine Zeile ohne Terminal-Echo, falls stdin ein Terminal ist,
// sonst (z.B. in einer Pipe/Skript) eine normale Zeile.
func readSecret() (string, error) {
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		data, err := term.ReadPassword(fd)
		fmt.Println()
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return line, nil
}

func cmdLogout(_ []string) error {
	if err := config.Remove(); err != nil {
		return err
	}
	fmt.Println("Abgemeldet.")
	return nil
}

func cmdWhoami(_ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg == nil {
		return fmt.Errorf(`nicht angemeldet, bitte zuerst "bahnping login <server-url>" ausführen`)
	}
	client := apiclient.New(cfg.Server, cfg.Token)
	ctx := context.Background()
	me, err := client.Me(ctx)
	if err != nil {
		return fmt.Errorf("/api/me fehlgeschlagen: %w", err)
	}
	fmt.Printf("Server    %s\n", cfg.Server)
	fmt.Printf("Konto     %s", me.Email)
	if me.DisplayName != nil && *me.DisplayName != "" {
		fmt.Printf(" (%s)", *me.DisplayName)
	}
	fmt.Printf("  Rolle %s\n", me.Role)

	w, err := client.Whoami(ctx)
	if err != nil {
		fmt.Printf("Netz      nicht ermittelbar (%v)\n", err)
		return nil
	}
	ipv := "–"
	if w.IPVersion != nil {
		ipv = fmt.Sprintf("IPv%d", *w.IPVersion)
	}
	fmt.Printf("Netz      %s  ASN %d (%s)  %s\n", w.Label, w.Asn, orDash(w.AsName), ipv)
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "–"
	}
	return s
}
