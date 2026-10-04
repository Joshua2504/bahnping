package stats

import "sync"

// RttRing hält die letzten `capacity` empfangenen RTT-Werte vor (für rttIdleMs/rttLoadedMs
// beim Speedtest: Median der letzten 5 RTTs davor bzw. währenddessen).
type RttRing struct {
	mu       sync.Mutex
	values   []float64
	capacity int
}

// NewRttRing erzeugt einen Ring mit der gegebenen Kapazität.
func NewRttRing(capacity int) *RttRing {
	return &RttRing{capacity: capacity}
}

// Add fügt einen neuen RTT-Wert hinzu (verdrängt den ältesten, wenn voll).
func (r *RttRing) Add(v float64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.values = append(r.values, v)
	if len(r.values) > r.capacity {
		r.values = r.values[len(r.values)-r.capacity:]
	}
}

// Snapshot liefert eine Kopie der aktuell gespeicherten Werte.
func (r *RttRing) Snapshot() []float64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]float64(nil), r.values...)
}

// Median liefert den Median der aktuell gespeicherten Werte, nil wenn leer.
func (r *RttRing) Median() *float64 {
	return Median(r.Snapshot())
}
