// Package speedtest misst Download/Upload exakt nach dem Verfahren aus PLANUNG.md 6.4:
// 4 parallele Streams, 8s Dauer, erste Sekunde (Ramp-up) verworfen (Fallback Gesamtzeit,
// falls danach nichts mehr ankam), SPEEDTEST_MAX_BYTES als Gesamtbudget je Richtung.
package speedtest

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"sync"
	"time"

	"github.com/treudler/bahnping-cli/internal/apiclient"
	"github.com/treudler/bahnping-cli/internal/model"
)

const (
	// chunkBytes ist die Blockgröße je Download-Request.
	chunkBytes = 4 * 1024 * 1024
	streams    = model.SpeedtestStreams
)

// Variablen statt Konstanten, damit Tests die Testdauer verkürzen können.
var (
	duration = time.Duration(model.SpeedtestDurationMs) * time.Millisecond
	rampUp   = 1 * time.Second
)

// Result ist das Ergebnis eines Speedtests (ohne RTT-Felder, die kennt nur der Aufrufer).
type Result struct {
	DownBps    *float64
	UpBps      *float64
	DurationMs int64
}

// rampCounter zählt übertragene Bytes gesamt und getrennt die nach rampEnd übertragenen.
type rampCounter struct {
	mu      sync.Mutex
	rampEnd time.Time
	total   int64
	post    int64
}

func (c *rampCounter) add(n int) {
	now := time.Now()
	c.mu.Lock()
	c.total += int64(n)
	if now.After(c.rampEnd) {
		c.post += int64(n)
	}
	c.mu.Unlock()
}

// countingReader zählt beim Lesen empfangene Bytes mit (Download).
type countingReader struct {
	r io.Reader
	c *rampCounter
}

func (cr countingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	if n > 0 {
		cr.c.add(n)
	}
	return n, err
}

// Download führt den Download-Teil aus (4 parallele GET /api/speed/down-Streams).
func Download(ctx context.Context, api *apiclient.Client) *float64 {
	start := time.Now()
	// Harte Deadline: laufende Requests werden nach der Testdauer abgebrochen, sonst hängt ein
	// langsamer 4-MiB-Block bis zum HTTP-Timeout (15 s) und verlängert den Test.
	ctx, cancel := context.WithDeadline(ctx, start.Add(duration))
	defer cancel()
	counter := &rampCounter{rampEnd: start.Add(rampUp)}
	var budgetMu sync.Mutex
	budget := int64(model.SpeedtestMaxBytes)

	var wg sync.WaitGroup
	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 64*1024)
			for ctx.Err() == nil {
				budgetMu.Lock()
				n := int64(chunkBytes)
				if n > budget {
					n = budget
				}
				budget -= n
				budgetMu.Unlock()
				if n <= 0 {
					return
				}
				body, err := api.SpeedDown(ctx, int(n))
				if err != nil {
					return
				}
				io.CopyBuffer(io.Discard, countingReader{body, counter}, buf) //nolint:errcheck // Abbruch an der Deadline ist erwartet
				body.Close()
			}
		}()
	}
	wg.Wait()
	return bpsFromCounts(counter.total, counter.post, time.Since(start))
}

func bpsFromCounts(total, post int64, elapsed time.Duration) *float64 {
	effective := elapsed - rampUp
	if post > 0 && effective > 0 {
		v := float64(post) * 8 / effective.Seconds()
		return &v
	}
	if total > 0 && elapsed > 0 {
		// Fallback: Gesamtzeit, wenn nach der Ramp-up-Phase nichts mehr ankam.
		v := float64(total) * 8 / elapsed.Seconds()
		return &v
	}
	return nil
}

// randomBlock erzeugt einen Zufallsblock der gegebenen Größe für den Upload-Test.
func randomBlock(n int) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	return buf, nil
}

// Upload führt den Upload-Teil aus (4 parallele Folgen von POST /api/speed/up).
//
// Gezählt werden nur Blöcke, deren Antwort vom Server kam. Bytes beim Lesen aus dem Body zu
// zählen misst nur Puffer: Der HTTP/2-Transport liest je Stream sofort bis zu 512 KiB, bei
// langsamem Uplink ergab das unabhängig vom Netz immer 4 × 512 KiB in 8 s ≈ 2,1 Mbit/s.
// Die Blockgröße passt sich an, damit ein Block etwa SpeedtestUpTargetMs dauert; als Zeitbasis
// dient die volle Testdauer, noch laufende Blöcke fallen weg (eher konservativ).
func Upload(ctx context.Context, api *apiclient.Client) *float64 {
	block, err := randomBlock(model.SpeedtestUpChunkMaxBytes)
	if err != nil {
		return nil
	}

	start := time.Now()
	ctx, cancel := context.WithDeadline(ctx, start.Add(duration))
	defer cancel()
	counter := &rampCounter{rampEnd: start.Add(rampUp)}
	var budgetMu sync.Mutex
	budget := int64(model.SpeedtestMaxBytes)

	var wg sync.WaitGroup
	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			size := int64(model.SpeedtestUpChunkStartBytes)
			for ctx.Err() == nil {
				budgetMu.Lock()
				n := min(size, budget)
				budget -= n
				budgetMu.Unlock()
				if n <= 0 {
					return
				}
				reqStart := time.Now()
				if err := api.SpeedUp(ctx, bytes.NewReader(block[:n]), n); err != nil {
					return
				}
				counter.add(int(n))
				size = nextUpChunk(size, time.Since(reqStart))
			}
		}()
	}
	wg.Wait()
	return bpsFromCounts(counter.total, counter.post, time.Since(start))
}

// nextUpChunk skaliert die Blockgröße Richtung SpeedtestUpTargetMs, höchstens Faktor 2 je Schritt.
func nextUpChunk(size int64, took time.Duration) int64 {
	target := time.Duration(model.SpeedtestUpTargetMs) * time.Millisecond
	next := size * 2
	if took > 0 {
		next = min(int64(float64(size)*float64(target)/float64(took)), size*2)
	}
	next = max(next, size/2)
	return min(max(next, model.SpeedtestUpChunkMinBytes), model.SpeedtestUpChunkMaxBytes)
}

// Run führt Download- und Upload-Test hintereinander aus und liefert ein Result.
// rttRing wird vor und während des Tests abgefragt (RttIdle/RttLoaded bestimmt der Aufrufer).
func Run(ctx context.Context, api *apiclient.Client) Result {
	start := time.Now()
	down := Download(ctx, api)
	up := Upload(ctx, api)
	return Result{DownBps: down, UpBps: up, DurationMs: time.Since(start).Milliseconds()}
}
