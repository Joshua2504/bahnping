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

// countingReader zählt beim Lesen mit. Beim Download sind das empfangene Bytes, beim Upload
// die Bytes, die der HTTP-Transport gerade abschickt (wie xhr.upload.onprogress im Browser).
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

// Upload führt den Upload-Teil aus (4 parallele POST /api/speed/up mit 4-MiB-Zufallsblöcken).
func Upload(ctx context.Context, api *apiclient.Client) *float64 {
	block, err := randomBlock(chunkBytes)
	if err != nil {
		return nil
	}

	start := time.Now()
	ctx, cancel := context.WithDeadline(ctx, start.Add(duration))
	defer cancel()
	// Bytes werden beim Senden gezählt, nicht erst nach komplettem Block: Bei langsamem
	// Uplink wird ein 4-MiB-Block oft gar nicht fertig, das Ergebnis wäre sonst leer.
	counter := &rampCounter{rampEnd: start.Add(rampUp)}
	var budgetMu sync.Mutex
	budget := int64(model.SpeedtestMaxBytes)

	var wg sync.WaitGroup
	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ctx.Err() == nil {
				budgetMu.Lock()
				n := int64(len(block))
				if n > budget {
					n = budget
				}
				budget -= n
				budgetMu.Unlock()
				if n <= 0 {
					return
				}
				body := countingReader{bytes.NewReader(block[:n]), counter}
				if err := api.SpeedUp(ctx, body, n); err != nil {
					return
				}
			}
		}()
	}
	wg.Wait()
	return bpsFromCounts(counter.total, counter.post, time.Since(start))
}

// Run führt Download- und Upload-Test hintereinander aus und liefert ein Result.
// rttRing wird vor und während des Tests abgefragt (RttIdle/RttLoaded bestimmt der Aufrufer).
func Run(ctx context.Context, api *apiclient.Client) Result {
	start := time.Now()
	down := Download(ctx, api)
	up := Upload(ctx, api)
	return Result{DownBps: down, UpBps: up, DurationMs: time.Since(start).Milliseconds()}
}
