// Package stats verdichtet Server-Pings zu WINDOW_MS-Fenstern, exakt wie
// apps/web/src/lib/tracker/windows.ts (PingWindowAggregator) und util.ts
// (median/percentile/meanAbsDiff), damit CLI und Browser vergleichbare Werte liefern.
package stats

import (
	"math"
	"sort"
	"sync"

	"github.com/treudler/bahnnet-cli/internal/model"
)

// ExpectedPingsPerWindow = WINDOW_MS / PING_INTERVAL_MS = 5.
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

// Compute berechnet ein WindowResult aus den im Fenster empfangenen RTTs (in
// Empfangsreihenfolge), exakt wie PingWindowAggregator.flush() in windows.ts.
func Compute(rtts []float64) WindowResult {
	n := ExpectedPingsPerWindow
	lost := n - len(rtts)
	if lost < 0 {
		lost = 0
	}
	return WindowResult{
		N:         n,
		Lost:      lost,
		RttMin:    minFloat(rtts),
		RttMedian: Median(rtts),
		RttP90:    Percentile(rtts, 90),
		RttMax:    maxFloat(rtts),
		JitterMs:  MeanAbsDiff(rtts),
	}
}

// Aggregator sammelt RTT-Werte für das aktuelle Fenster, threadsicher nutzbar
// (RTTs kommen aus dem WS-Lesegoroutine, Flush aus einem Timer).
type Aggregator struct {
	mu   sync.Mutex
	rtts []float64
}

// AddRtt fügt einen RTT-Wert zum laufenden Fenster hinzu.
func (a *Aggregator) AddRtt(rttMs float64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.rtts = append(a.rtts, rttMs)
}

// Flush schließt das aktuelle Fenster ab und beginnt ein neues.
func (a *Aggregator) Flush() WindowResult {
	a.mu.Lock()
	rtts := a.rtts
	a.rtts = nil
	a.mu.Unlock()
	return Compute(rtts)
}
