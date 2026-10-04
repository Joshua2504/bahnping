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
