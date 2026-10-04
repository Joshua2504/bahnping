package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/treudler/bahnping-cli/internal/config"
)

// cmdUpdate lädt die zum Betriebssystem passende Binary von <server>/dl/ und ersetzt die
// laufende Datei (Download nach <exe>.new, dann atomar umbenennen). Der Server kommt aus der
// gespeicherten Anmeldung oder als Argument. Vorher wird /dl/VERSION verglichen, damit ein
// erneutes "update" ohne neue Version nichts herunterlädt.
func cmdUpdate(args []string) error {
	server := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		server = strings.TrimRight(args[0], "/")
	} else {
		cfg, err := config.Load()
		if err != nil {
			return err
		}
		if cfg == nil {
			return fmt.Errorf(`kein Server bekannt: "bahnping update <server-url>" oder zuerst "bahnping login"`)
		}
		server = strings.TrimRight(cfg.Server, "/")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 2 * time.Minute}

	if remote, err := fetchText(ctx, client, server+"/dl/VERSION"); err == nil && remote != "" {
		if remote == version {
			fmt.Printf("bahnping %s ist bereits aktuell.\n", version)
			return nil
		}
		fmt.Printf("Aktualisiere bahnping %s → %s ...\n", version, remote)
	} else {
		fmt.Println("Lade aktuelle Version ...")
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	name := fmt.Sprintf("bahnping-%s-%s", runtime.GOOS, runtime.GOARCH)
	url := server + "/dl/" + name

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("Download fehlgeschlagen: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Download fehlgeschlagen: HTTP %d für %s", resp.StatusCode, url)
	}

	tmp := exe + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		if os.IsPermission(err) {
			return fmt.Errorf("keine Schreibrechte für %s – mit sudo ausführen: sudo bahnping update", filepath.Dir(exe))
		}
		return err
	}
	n, copyErr := io.Copy(out, resp.Body)
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil || n < 1_000_000 {
		os.Remove(tmp)
		if copyErr == nil && closeErr == nil {
			return fmt.Errorf("Download unvollständig (%d Bytes)", n)
		}
		return fmt.Errorf("Download fehlgeschlagen: %v", firstErr(copyErr, closeErr))
	}
	if err := os.Rename(tmp, exe); err != nil {
		os.Remove(tmp)
		if os.IsPermission(err) {
			return fmt.Errorf("keine Schreibrechte für %s – mit sudo ausführen: sudo bahnping update", exe)
		}
		return err
	}
	fmt.Printf("Fertig: %s ersetzt (%d Bytes). Prüfen mit: bahnping version\n", exe, n)
	return nil
}

func fetchText(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 256))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func firstErr(errs ...error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}
