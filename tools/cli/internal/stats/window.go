// Package stats verdichtet Server-Pings zu WINDOW_MS-Fenstern, exakt wie
// apps/web/src/lib/tracker/windows.ts (PingWindowAggregator) und util.ts
// (median/percentile/meanAbsDiff), damit CLI und Browser vergleichbare Werte liefern.
package stats

import (
	"math"
	"sort"
	"sync"

	"github.com/treudler/bahnping-cli/internal/model"
)

// ExpectedPingsPerWindow = WINDOW_MS / PING_INTERVAL_MS.
const ExpectedPingsPerWindow = model.WindowMs / model.PingIntervalMs

// WindowResult entspricht WindowResult in windows.ts.
type WindowResult struct {
	N         int
	Lost      int
	RttMin    *float64
	RttMedian *float64
	RttP90    *float64
	RttMax    *float64
	JitterMs  *float64
}

// Median liefert den Median, nil bei leerer Liste. Spiegelt util.ts median().
func Median(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	var v float64
	if len(sorted)%2 == 0 {
		v = (sorted[mid-1] + sorted[mid]) / 2
	} else {
		v = sorted[mid]
	}
	return &v
}

// Percentile liefert das p-Perzentil (0..100), nil bei leerer Liste. Spiegelt util.ts percentile().
func Percentile(values []float64, p float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	idx := int(math.Ceil((p/100)*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx > len(sorted)-1 {
		idx = len(sorted) - 1
	}
	v := sorted[idx]
	return &v
}

// MeanAbsDiff liefert die mittlere absolute Differenz aufeinanderfolgender Werte
// (in der übergebenen, nicht sortierten Reihenfolge), nil bei weniger als 2 Werten.
func MeanAbsDiff(values []float64) *float64 {
	if len(values) < 2 {
		return nil
	}
	sum := 0.0
	for i := 1; i < len(values); i++ {
		sum += math.Abs(values[i] - values[i-1])
	}
	v := sum / float64(len(values)-1)
	return &v
}

func minFloat(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	m := values[0]
	for _, v := range values[1:] {
		if v < m {
			m = v
		}
	}
	return &m
}

func maxFloat(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	m := values[0]
	for _, v := range values[1:] {
		if v > m {
			m = v
		}
	}
	return &m
}

// Compute berechnet die RTT-Statistik eines Fensters aus den empfangenen RTTs (in
// Empfangsreihenfolge). N/Lost werden hier nur aus der Anzahl abgeleitet (kein Verlust);
// die Verlustzählung über Sequenznummern macht Aggregator.Flush (siehe dort).
func Compute(rtts []float64) WindowResult {
	n := len(rtts)
	if n == 0 {
		n = ExpectedPingsPerWindow
	}
	return WindowResult{
		N:         n,
		Lost:      n - len(rtts),
		RttMin:    minFloat(rtts),
		RttMedian: Median(rtts),
		RttP90:    Percentile(rtts, 90),
		RttMax:    maxFloat(rtts),
		JitterMs:  MeanAbsDiff(rtts),
	}
}

// Aggregator sammelt RTT-Werte für das aktuelle Fenster, threadsicher nutzbar
// (RTTs kommen aus dem WS-Lesegoroutine, Flush aus einem Timer).
//
// Verlust wird über die Sequenznummern der Server-Pings gezählt, nicht über eine erwartete
// Anzahl je Fenster: Pings kommen jede Sekunde, Fenster werden alle WINDOW_MS geschnitten – durch
// Timer-Drift landen mal 4, mal 6 Antworten in einem Fenster, was fälschlich als Verlust zählen
// würde. Stattdessen: n = Anzahl Sequenznummern, die der Server seit der letzten empfangenen
// Antwort des Vorfensters vergeben hat; lost = n − empfangen. Ein Fenster ganz ohne Antwort zählt
// als komplett verloren (ExpectedPingsPerWindow) und schiebt den Zähler virtuell weiter, damit die
// Lücke beim nächsten Fenster nicht doppelt zählt. Nach einem Reconnect (Sequenz springt zurück)
// zählt nur die Lücke innerhalb des Fensters. Exakt wie PingWindowAggregator in windows.ts.
type Aggregator struct {
	mu     sync.Mutex
	rtts   []float64
	minSeq int
	maxSeq int
	// letzte empfangene Sequenznummer des Vorfensters, -1 = keine Vorgeschichte
	prevLast int
	started  bool
}

// AddRtt fügt einen RTT-Wert (mit Sequenznummer des Server-Pings) zum laufenden Fenster hinzu.
func (a *Aggregator) AddRtt(seq int, rttMs float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.rtts) == 0 || seq < a.minSeq {
		a.minSeq = seq
	}
	if len(a.rtts) == 0 || seq > a.maxSeq {
		a.maxSeq = seq
	}
	a.rtts = append(a.rtts, rttMs)
}

// Pending meldet, ob im laufenden Fenster schon Antworten liegen (für den letzten Flush beim
// Beenden: ein angebrochenes Fenster ohne Antwort ist kein Verlust und wird verworfen).
func (a *Aggregator) Pending() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.rtts) > 0
}

// Flush schließt das aktuelle Fenster ab und beginnt ein neues.
func (a *Aggregator) Flush() WindowResult {
	a.mu.Lock()
	rtts, minSeq, maxSeq := a.rtts, a.minSeq, a.maxSeq
	a.rtts = nil
	if !a.started {
		a.prevLast = -1
		a.started = true
	}
	res := Compute(rtts)
	received := len(rtts)
	switch {
	case received == 0:
		res.N, res.Lost = ExpectedPingsPerWindow, ExpectedPingsPerWindow
		if a.prevLast >= 0 {
			a.prevLast += ExpectedPingsPerWindow
		}
	case a.prevLast < 0 || maxSeq < a.prevLast:
		res.N = maxSeq - minSeq + 1
		a.prevLast = maxSeq
	default:
		res.N = maxSeq - a.prevLast
		a.prevLast = maxSeq
	}
	if res.N < received {
		res.N = received
	}
	res.Lost = res.N - received
	a.mu.Unlock()
	return res
}
