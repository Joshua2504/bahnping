package speedtest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/treudler/bahnping-cli/internal/apiclient"
)

// shortTest verkürzt Testdauer und Ramp-up für die Dauer eines Tests.
func shortTest(t *testing.T) {
	t.Helper()
	oldDuration, oldRamp := duration, rampUp
	duration, rampUp = 600*time.Millisecond, 100*time.Millisecond
	t.Cleanup(func() { duration, rampUp = oldDuration, oldRamp })
}

// slowCopy schreibt in kleinen Stücken mit Pause, wie ein langsamer Zug-Uplink.
func slowCopy(w http.ResponseWriter, n int) {
	buf := make([]byte, 16*1024)
	for sent := 0; sent < n; sent += len(buf) {
		if _, err := w.Write(buf); err != nil {
			return
		}
		w.(http.Flusher).Flush()
		time.Sleep(20 * time.Millisecond)
	}
}

func newServer(t *testing.T, slow bool) (*apiclient.Client, *atomic.Int64) {
	t.Helper()
	var received atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/speed/down":
			n, _ := strconv.Atoi(r.URL.Query().Get("bytes"))
			w.Header().Set("Content-Length", strconv.Itoa(n))
			if slow {
				slowCopy(w, n)
				return
			}
			w.Write(make([]byte, n)) //nolint:errcheck
		case "/api/speed/up":
			buf := make([]byte, 16*1024)
			for {
				n, err := r.Body.Read(buf)
				received.Add(int64(n))
				if err != nil {
					break
				}
				if slow {
					time.Sleep(20 * time.Millisecond)
				}
			}
			w.Write([]byte(`{"bytes":0}`)) //nolint:errcheck
		}
	}))
	t.Cleanup(srv.Close)
	return apiclient.New(srv.URL, "test"), &received
}

func TestUploadFinishesAndMeasures(t *testing.T) {
	shortTest(t)
	api, received := newServer(t, false)
	start := time.Now()
	up := Upload(context.Background(), api)
	if up == nil || *up <= 0 {
		t.Fatalf("Upload ohne Ergebnis: %v", up)
	}
	if received.Load() == 0 {
		t.Fatal("Server hat keine Upload-Bytes erhalten")
	}
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("Upload hat die Testdauer deutlich überschritten: %v", d)
	}
}

func TestSlowLinkStopsAtDeadlineWithPartialResult(t *testing.T) {
	shortTest(t)
	api, _ := newServer(t, true)

	start := time.Now()
	down := Download(context.Background(), api)
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("Download hängt über die Deadline hinaus: %v", d)
	}
	if down == nil || *down <= 0 {
		t.Fatalf("Download ohne Ergebnis trotz Teilübertragung: %v", down)
	}

	start = time.Now()
	up := Upload(context.Background(), api)
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("Upload hängt über die Deadline hinaus: %v", d)
	}
	// Kein 4-MiB-Block wird fertig, trotzdem muss der Teil-Durchsatz gemessen werden.
	if up == nil || *up <= 0 {
		t.Fatalf("Upload ohne Ergebnis trotz Teilübertragung: %v", up)
	}
}

// Upload darf nicht schneller erscheinen als der Server tatsächlich liest: Früher wurden Bytes
// beim Einlesen in Transport-Puffer gezählt, was bei langsamem Uplink einen festen Wert ergab.
func TestUploadNotInflatedByBuffers(t *testing.T) {
	oldDuration, oldRamp := duration, rampUp
	duration, rampUp = 2*time.Second, 300*time.Millisecond
	t.Cleanup(func() { duration, rampUp = oldDuration, oldRamp })

	api, _ := newServer(t, true)
	up := Upload(context.Background(), api)
	if up == nil {
		t.Fatal("Upload ohne Ergebnis")
	}
	// Server liest je Stream 16 KiB pro ≥20 ms, bei 4 Streams also höchstens ~26 Mbit/s.
	const serverMaxBps = 4 * 16 * 1024 * 8 / 0.020
	if *up > serverMaxBps*1.2 {
		t.Fatalf("Upload %.1f Mbit/s über dem, was der Server lesen kann (%.1f Mbit/s)", *up/1e6, serverMaxBps/1e6)
	}
	if *up < serverMaxBps*0.3 {
		t.Fatalf("Upload %.1f Mbit/s unplausibel niedrig (Server max. %.1f Mbit/s)", *up/1e6, serverMaxBps/1e6)
	}
}

func TestNextUpChunk(t *testing.T) {
	cases := []struct {
		size int64
		took time.Duration
		want int64
	}{
		{256 * 1024, 250 * time.Millisecond, 512 * 1024},  // zu schnell: höchstens verdoppeln
		{256 * 1024, 4 * time.Second, 128 * 1024},         // zu langsam: höchstens halbieren
		{256 * 1024, 1 * time.Second, 256 * 1024},         // Zielzeit getroffen
		{32 * 1024, 10 * time.Second, 32 * 1024},          // Untergrenze
		{4 * 1024 * 1024, 10 * time.Millisecond, 4 << 20}, // Obergrenze
	}
	for _, c := range cases {
		if got := nextUpChunk(c.size, c.took); got != c.want {
			t.Errorf("nextUpChunk(%d, %v) = %d, erwartet %d", c.size, c.took, got, c.want)
		}
	}
}
