// Package tui zeichnet die Live-Ansicht im Terminal (ANSI, 1x/s neu, siehe
// PLANUNG.md 6.9) bzw. im --plain-Modus eine Zeile pro Fenster für Logs.
package tui

import (
	"fmt"
	"sync"
	"time"
)

// RttHistoryCap ist die Anzahl der RTT-Werte, die für die Sparkline vorgehalten werden
// (letzte 60, siehe Aufgabenbeschreibung).
const RttHistoryCap = 60

// Snapshot ist eine kopierbare Momentaufnahme des Anzeigezustands (ohne Mutex),
// wie sie Render/RenderPlainLine entgegennehmen.
type Snapshot struct {
	TripID     string
	TrainLabel string
	StartedAt  time.Time

	RttHistory []float64
	LastRttMs  *float64
	JitterMs   *float64
	Loss60sPct *float64
	AvailPct   *float64

	NetLabel  string
	NetAsn    int
	NetAsName string
	IPVersion *int

	IcePortalAvailable bool
	IceSpeedKmh        *float64
	IceState           string
	NextStopName       string
	NextStopDelayMin   *int

	PosLat    *float64
	PosLon    *float64
	PosSource string

	Captive bool

	OutboxPending int
	UploadStatus  string

	LastSpeedtest string

	ConnectedWS bool
}

// State ist der threadsicher aktualisierbare Anzeigezustand. Alle Felder, die aus
// mehreren Goroutinen (WS, ICE-Portal-Poller, Outbox-Uploader, Haupt-Loop) kommen,
// werden über AddRtt/Update geschrieben, Render liest über Snapshot().
type State struct {
	mu sync.Mutex
	Snapshot
}

// NewState erzeugt einen leeren Anzeigezustand.
func NewState() *State {
	return &State{Snapshot: Snapshot{UploadStatus: "-", LastSpeedtest: "noch keiner"}}
}

// AddRtt fügt einen neuen RTT-Wert zur Sparkline-Historie hinzu.
func (s *State) AddRtt(v float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.LastRttMs = &v
	s.RttHistory = append(s.RttHistory, v)
	if len(s.RttHistory) > RttHistoryCap {
		s.RttHistory = s.RttHistory[len(s.RttHistory)-RttHistoryCap:]
	}
}

// Update führt eine beliebige Änderung unter Lock aus (für größere Teil-Updates).
func (s *State) Update(fn func(*Snapshot)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.Snapshot)
}

// Snapshot liefert eine flache Kopie für das Rendering (RttHistory separat kopiert).
func (s *State) Snap() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	cp := s.Snapshot
	cp.RttHistory = append([]float64(nil), s.Snapshot.RttHistory...)
	return cp
}

func fmtFloatPtr(v *float64, unit string, decimals int) string {
	if v == nil {
		return "–"
	}
	return fmt.Sprintf("%.*f%s", decimals, *v, unit)
}

func fmtIntPtr(v *int, unit string) string {
	if v == nil {
		return "–"
	}
	return fmt.Sprintf("%d%s", *v, unit)
}
