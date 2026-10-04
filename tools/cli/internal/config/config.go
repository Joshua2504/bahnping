// Package config verwaltet die lokale Konfigurationsdatei (Server-URL + API-Token).
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Config ist der Inhalt von config.json.
type Config struct {
	Server string `json:"server"`
	Token  string `json:"token"`
}

// Dir liefert $XDG_CONFIG_HOME/bahnping bzw. ~/.config/bahnping.
func Dir() (string, error) {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "bahnping"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("Home-Verzeichnis nicht ermittelbar: %w", err)
	}
	return filepath.Join(home, ".config", "bahnping"), nil
}

// Path liefert den vollen Pfad zu config.json.
func Path() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.json"), nil
}

// Load liest die Konfiguration. Existiert die Datei nicht, wird (nil, nil) zurückgegeben.
// legacyName ist der frühere Name der CLI; Konfiguration und Puffer werden einmalig übernommen.
const legacyName = "bahnnet"

// migrateLegacyDir benennt ein altes Verzeichnis (…/bahnnet) in das neue (…/bahnping) um,
// sofern das neue noch nicht existiert.
func migrateLegacyDir(newDir string) {
	oldDir := filepath.Join(filepath.Dir(newDir), legacyName)
	if _, err := os.Stat(newDir); err == nil {
		return
	}
	if _, err := os.Stat(oldDir); err != nil {
		return
	}
	_ = os.Rename(oldDir, newDir)
}

// legacyServers werden beim Laden auf die neue Adresse umgeschrieben.
var legacyServers = map[string]string{
	"https://bahnnet.treudler.net": "https://bahnping.treudler.net",
}

func Load() (*Config, error) {
	if dir, err := Dir(); err == nil {
		migrateLegacyDir(dir)
	}
	if dir, err := StateDir(); err == nil {
		migrateLegacyDir(dir)
	}
	path, err := Path()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("Konfiguration konnte nicht gelesen werden: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("Konfiguration ist beschädigt (%s): %w", path, err)
	}
	if newURL, ok := legacyServers[strings.TrimRight(cfg.Server, "/")]; ok {
		cfg.Server = newURL
		_ = Save(&cfg)
	}
	return &cfg, nil
}

// Save schreibt die Konfiguration mit Berechtigung 0600 (enthält ein Geheimnis).
func Save(cfg *Config) error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("Konfigurationsverzeichnis konnte nicht angelegt werden: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path, err := Path()
	if err != nil {
		return err
	}
	// 0600 explizit setzen (nicht nur beim Anlegen), falls die Datei schon existierte.
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("Konfiguration konnte nicht gespeichert werden: %w", err)
	}
	return os.Chmod(path, 0600)
}

// Remove löscht die Konfigurationsdatei (logout). Fehlt sie bereits, ist das kein Fehler.
func Remove() error {
	path, err := Path()
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("Konfiguration konnte nicht gelöscht werden: %w", err)
	}
	return nil
}

// StateDir liefert das Verzeichnis für Laufzeitdaten (Outbox), analog XDG_STATE_HOME.
func StateDir() (string, error) {
	if xdg := os.Getenv("XDG_STATE_HOME"); xdg != "" {
		return filepath.Join(xdg, "bahnping"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("Home-Verzeichnis nicht ermittelbar: %w", err)
	}
	return filepath.Join(home, ".local", "state", "bahnping"), nil
}
