// Package speedtest misst Download/Upload exakt nach dem Verfahren aus PLANUNG.md 6.4:
// 4 parallele Streams, 8s Dauer, erste Sekunde (Ramp-up) verworfen (Fallback Gesamtzeit,
// falls danach nichts mehr ankam), SPEEDTEST_MAX_BYTES als Gesamtbudget je Richtung.
package speedtest

import (
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
	duration   = time.Duration(model.SpeedtestDurationMs) * time.Millisecond
	rampUp     = 1 * time.Second
)

// Result ist das Ergebnis eines Speedtests (ohne RTT-Felder, die kennt nur der Aufrufer).
type Result struct {
	DownBps    *float64
	UpBps      *float64
	DurationMs int64
}

// countingRampReader liest aus r und zählt total sowie die Bytes, die nach rampEnd gelesen wurden.
type countingRampReader struct {
	r       io.Reader
	rampEnd time.Time
	mu      *sync.Mutex
	total   *int64
	post    *int64
}

func (c *countingRampReader) discard() {
	buf := make([]byte, 64*1024)
	for {
		n, err := c.r.Read(buf)
		if n > 0 {
			now := time.Now()
			c.mu.Lock()
			*c.total += int64(n)
			if now.After(c.rampEnd) {
				*c.post += int64(n)
			}
			c.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

// Download führt den Download-Teil aus (4 parallele GET /api/speed/down-Streams).
func Download(ctx context.Context, api *apiclient.Client) *float64 {
	deadline := time.Now().Add(duration)
	rampEnd := time.Now().Add(rampUp)
	var mu sync.Mutex
	var total, post int64
	var budgetMu sync.Mutex
	budget := int64(model.SpeedtestMaxBytes)
	start := time.Now()

	var wg sync.WaitGroup
	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Now().Before(deadline) {
				if ctx.Err() != nil {
					return
				}
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
				(&countingRampReader{r: body, rampEnd: rampEnd, mu: &mu, total: &total, post: &post}).discard()
				body.Close()
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)
	return bpsFromCounts(total, post, elapsed)
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
	deadline := time.Now().Add(duration)
	rampEnd := time.Now().Add(rampUp)
	var mu sync.Mutex
	var total, post int64
	var budgetMu sync.Mutex
	budget := int64(model.SpeedtestMaxBytes)
	start := time.Now()

	block, err := randomBlock(chunkBytes)
	if err != nil {
		return nil
	}

	var wg sync.WaitGroup
	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for time.Now().Before(deadline) {
				if ctx.Err() != nil {
					return
				}
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
				chunk := block
				if n != int64(len(block)) {
					chunk = block[:n]
				}
				reqStart := time.Now()
				if err := api.SpeedUp(ctx, byteReader(chunk), n); err != nil {
					return
				}
				now := time.Now()
				mu.Lock()
				total += n
				// Konservativ: Request wird dem Post-Ramp-Topf zugerechnet, wenn er
				// (überwiegend) nach Ablauf der Ramp-up-Sekunde beendet wurde.
				if now.After(rampEnd) && reqStart.After(rampEnd) {
					post += n
				}
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)
	return bpsFromCounts(total, post, elapsed)
}

func byteReader(b []byte) io.Reader {
	return io.NopCloser(io.Reader(onceReader{b}))
}

// onceReader liest einen Byte-Slice einmal komplett (einfacher als bytes.Reader zu importieren,
// aber äquivalent – hier nur zur klaren Intention, dass der Block nicht wiederverwendet wird).
type onceReader struct{ b []byte }

func (o onceReader) Read(p []byte) (int, error) {
	if len(o.b) == 0 {
		return 0, io.EOF
	}
	n := copy(p, o.b)
	o.b = o.b[n:]
	return n, nil
}

// Run führt Download- und Upload-Test hintereinander aus und liefert ein Result.
// rttRing wird vor und während des Tests abgefragt (RttIdle/RttLoaded bestimmt der Aufrufer).
func Run(ctx context.Context, api *apiclient.Client) Result {
	start := time.Now()
	down := Download(ctx, api)
	up := Upload(ctx, api)
	return Result{DownBps: down, UpBps: up, DurationMs: time.Since(start).Milliseconds()}
}
