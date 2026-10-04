// Package outbox ist eine lokale, dateibasierte Warteschlange für Samples, die noch nicht
// bestätigt hochgeladen wurden (siehe PLANUNG.md 6.8). Jede Zeile der Datei ist ein
// JSON-kodiertes model.Sample. Neue Einträge werden angehängt (O_APPEND), beim Abschicken
// eines Batches werden die ältesten N Zeilen entfernt (Datei neu geschrieben + atomar ersetzt).
package outbox

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/treudler/bahnnet-cli/internal/model"
)

// Outbox verwaltet die Datei outbox-<tripId>.jsonl in einem Zustandsverzeichnis.
type Outbox struct {
	path string
	mu   sync.Mutex
}

// Open öffnet/erzeugt die Outbox-Datei für die gegebene Fahrt-ID im Zustandsverzeichnis.
func Open(stateDir, tripID string) (*Outbox, error) {
	if err := os.MkdirAll(stateDir, 0700); err != nil {
		return nil, fmt.Errorf("Zustandsverzeichnis konnte nicht angelegt werden: %w", err)
	}
	path := filepath.Join(stateDir, "outbox-"+tripID+".jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND, 0600)
	if err != nil {
		return nil, fmt.Errorf("Outbox konnte nicht geöffnet werden: %w", err)
	}
	f.Close()
	return &Outbox{path: path}, nil
}

// FindExisting sucht vorhandene Outbox-Dateien im Zustandsverzeichnis (für den Nachsende-Hinweis
// beim Start, auch für Fahrten, die in einem früheren Lauf nicht beendet wurden).
func FindExisting(stateDir string) ([]string, error) {
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var paths []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if len(name) > len("outbox-")+len(".jsonl") && name[:7] == "outbox-" && filepath.Ext(name) == ".jsonl" {
			paths = append(paths, filepath.Join(stateDir, name))
		}
	}
	return paths, nil
}

// Append hängt ein Sample an die Outbox-Datei an.
func (o *Outbox) Append(s model.Sample) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(o.path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return fmt.Errorf("Outbox konnte nicht zum Schreiben geöffnet werden: %w", err)
	}
	defer f.Close()
	if _, err := f.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("Sample konnte nicht an die Outbox angehängt werden: %w", err)
	}
	return f.Sync()
}

// Peek liest bis zu max Samples vom Anfang der Datei, ohne sie zu entfernen.
func (o *Outbox) Peek(max int) ([]model.Sample, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.readAllLocked(max)
}

// Count liefert die Gesamtzahl der aktuell gepufferten Samples.
func (o *Outbox) Count() (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	all, err := o.readAllLocked(-1)
	if err != nil {
		return 0, err
	}
	return len(all), nil
}

func (o *Outbox) readAllLocked(max int) ([]model.Sample, error) {
	f, err := os.Open(o.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	var out []model.Sample
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var s model.Sample
		if err := json.Unmarshal(line, &s); err != nil {
			// Beschädigte Zeile überspringen, statt die ganze Outbox zu verlieren.
			continue
		}
		out = append(out, s)
		if max > 0 && len(out) >= max {
			break
		}
	}
	return out, scanner.Err()
}

// RemoveFront entfernt die ersten n Samples aus der Outbox-Datei (atomar über eine Temp-Datei),
// nachdem sie erfolgreich an den Server übermittelt wurden (egal ob accepted/duplicate/rejected –
// der Server hat definitiv geantwortet).
func (o *Outbox) RemoveFront(n int) error {
	if n <= 0 {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()

	f, err := os.Open(o.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var remaining [][]byte
	skipped := 0
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		if skipped < n {
			skipped++
			continue
		}
		remaining = append(remaining, append([]byte(nil), line...))
	}
	f.Close()
	if err := scanner.Err(); err != nil {
		return err
	}

	tmp := o.path + ".tmp"
	tf, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(tf)
	for _, line := range remaining {
		w.Write(line) //nolint:errcheck
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		tf.Close()
		return err
	}
	if err := tf.Sync(); err != nil {
		tf.Close()
		return err
	}
	if err := tf.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, o.path)
}

// Remove löscht die Outbox-Datei vollständig (nach erfolgreichem Fahrtende ohne Rest).
func (o *Outbox) Remove() error {
	o.mu.Lock()
	defer o.mu.Unlock()
	err := os.Remove(o.path)
	if err != nil && os.IsNotExist(err) {
		return nil
	}
	return err
}

// Path liefert den Dateipfad (für Diagnose/Logs).
func (o *Outbox) Path() string { return o.path }
