package main

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/treudler/bahnnet-cli/internal/apiclient"
	"github.com/treudler/bahnnet-cli/internal/iceportal"
	"github.com/treudler/bahnnet-cli/internal/model"
	"github.com/treudler/bahnnet-cli/internal/outbox"
	"github.com/treudler/bahnnet-cli/internal/speedtest"
	"github.com/treudler/bahnnet-cli/internal/stats"
	"github.com/treudler/bahnnet-cli/internal/tui"
	"github.com/treudler/bahnnet-cli/internal/wsclient"
)

// positionMaxAge: ICE-Portal-Status wird nur verwendet, wenn er jünger als dieser Wert ist.
const positionMaxAge = 15 * time.Second

// trackSession bündelt den gesamten Laufzeitzustand einer Fahrt.
type trackSession struct {
	ctx    context.Context
	cancel context.CancelFunc

	api       *apiclient.Client
	trip      *model.Trip
	trainType model.TrainType

	outbox *outbox.Outbox
	poller *iceportal.Poller
	ws     *wsclient.Client

	aggregator *stats.Aggregator
	rttRing    *stats.RttRing
	state      *tui.State
	flags      *trackFlags

	flushNow chan struct{}

	netMu    sync.Mutex
	netToken *model.NetToken

	winMu            sync.Mutex
	recentWindows    []stats.WindowResult
	windowsTotal     int
	windowsWithReply int
}

func newTrackSession(ctx context.Context, cancel context.CancelFunc) *trackSession {
	return &trackSession{ctx: ctx, cancel: cancel, flushNow: make(chan struct{}, 1)}
}

// ---------- Position / Netz für Samples ----------

func (s *trackSession) positionFields() (lat, lon, speedMps *float64, iceState *string, posSource string) {
	if s.flags.noPosition {
		return nil, nil, nil, nil, "none"
	}
	st := s.poller.FreshStatus(positionMaxAge)
	if st == nil || st.Latitude == nil || st.Longitude == nil {
		return nil, nil, nil, nil, "none"
	}
	return st.Latitude, st.Longitude, st.SpeedMps(), st.IceState(), "iceportal"
}

func (s *trackSession) currentNetToken() *model.NetToken {
	s.netMu.Lock()
	defer s.netMu.Unlock()
	return s.netToken
}

func (s *trackSession) setNetToken(t *model.NetToken) {
	s.netMu.Lock()
	s.netToken = t
	s.netMu.Unlock()
}

func (s *trackSession) buildSampleBase(kind string) model.Sample {
	lat, lon, speedMps, iceState, posSource := s.positionFields()
	return model.Sample{
		ID:        model.NewID(),
		Ts:        time.Now().UnixMilli(),
		Lat:       lat,
		Lon:       lon,
		AccuracyM: nil,
		SpeedMps:  speedMps,
		Heading:   nil,
		Net:       s.currentNetToken(),
		IceState:  iceState,
		PosSource: posSource,
		Kind:      kind,
	}
}

func (s *trackSession) appendSample(sample model.Sample) {
	if err := s.outbox.Append(sample); err != nil {
		if s.flags.debug {
			fmt.Fprintf(os.Stderr, "[debug] Outbox-Fehler: %v\n", err)
		}
		return
	}
	n, err := s.outbox.Count()
	if err != nil {
		return
	}
	s.state.Update(func(sn *tui.Snapshot) { sn.OutboxPending = n })
	if n >= 100 {
		select {
		case s.flushNow <- struct{}{}:
		default:
		}
	}
}

// ---------- Ping-Fenster ----------

func (s *trackSession) pingWindowLoop() {
	ticker := time.NewTicker(model.WindowDuration)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
		s.handleWindow(s.aggregator.Flush())
	}
}

func (s *trackSession) handleWindow(res stats.WindowResult) {
	sample := s.buildSampleBase(model.SampleKindPingWindow)
	sample.N = res.N
	sample.Lost = res.Lost
	sample.RttMin = res.RttMin
	sample.RttMedian = res.RttMedian
	sample.RttP90 = res.RttP90
	sample.RttMax = res.RttMax
	sample.JitterMs = res.JitterMs
	s.appendSample(sample)

	s.winMu.Lock()
	s.recentWindows = append(s.recentWindows, res)
	if len(s.recentWindows) > 6 {
		s.recentWindows = s.recentWindows[len(s.recentWindows)-6:]
	}
	var lostSum, nSum int
	for _, w := range s.recentWindows {
		lostSum += w.Lost
		nSum += w.N
	}
	s.windowsTotal++
	if res.N > res.Lost {
		s.windowsWithReply++
	}
	windowsTotal, windowsWithReply := s.windowsTotal, s.windowsWithReply
	s.winMu.Unlock()

	var loss60 *float64
	if nSum > 0 {
		v := 100 * float64(lostSum) / float64(nSum)
		loss60 = &v
	}
	var avail *float64
	if windowsTotal > 0 {
		v := 100 * float64(windowsWithReply) / float64(windowsTotal)
		avail = &v
	}

	var snap tui.Snapshot
	s.state.Update(func(sn *tui.Snapshot) {
		sn.Loss60sPct = loss60
		sn.AvailPct = avail
		sn.JitterMs = res.JitterMs
		snap = *sn
	})

	if s.flags.plain {
		fmt.Println(tui.RenderPlainLine(snap))
	}
}

// ---------- ICE-Portal-Anzeige ----------

// icePortalDisplayLoop aktualisiert nur die Live-Ansicht (Snapshot-Felder IcePortalAvailable,
// Geschwindigkeit, Status, nächster Halt, Position) – die tatsächlich gesendeten Sample-Felder
// kommen unabhängig davon aus buildSampleBase()/positionFields().
func (s *trackSession) icePortalDisplayLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		s.updateIcePortalDisplay()
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *trackSession) updateIcePortalDisplay() {
	st := s.poller.FreshStatus(positionMaxAge)
	trip, _ := s.poller.Trip()

	var nextStopName string
	var delayMin *int
	if next := trip.NextStop(); next != nil {
		if next.StationName != nil {
			nextStopName = *next.StationName
		}
		if next.ScheduledArrivalTimeMs != nil && next.ActualArrivalTimeMs != nil {
			d := int((*next.ActualArrivalTimeMs - *next.ScheduledArrivalTimeMs) / 60000)
			delayMin = &d
		}
	}

	s.state.Update(func(sn *tui.Snapshot) {
		sn.IcePortalAvailable = st != nil
		sn.IcePortalError = s.poller.LastError()
		sn.NextStopName = nextStopName
		sn.NextStopDelayMin = delayMin
		if st == nil {
			sn.IceSpeedKmh = nil
			sn.IceState = ""
			if s.flags.noPosition {
				sn.PosLat, sn.PosLon, sn.PosSource = nil, nil, "none"
			}
			return
		}
		sn.IceSpeedKmh = st.SpeedKmh
		if state := st.IceState(); state != nil {
			sn.IceState = *state
		} else {
			sn.IceState = ""
		}
		if s.flags.noPosition {
			sn.PosLat, sn.PosLon, sn.PosSource = nil, nil, "none"
		} else {
			sn.PosLat, sn.PosLon, sn.PosSource = st.Latitude, st.Longitude, "iceportal"
		}
	})
}

// ---------- Probe ----------

func (s *trackSession) probeLoop() {
	s.doProbe() // sofort eine erste Probe, nicht erst nach 30s
	ticker := time.NewTicker(model.ProbeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
		s.doProbe()
	}
}

func (s *trackSession) doProbe() {
	result := s.api.Probe(s.ctx)
	sample := s.buildSampleBase(model.SampleKindProbe)
	httpMs := result.HTTPMs
	ok := result.Ok
	captive := result.Captive
	sample.HttpMs = &httpMs
	sample.Ok = &ok
	sample.Captive = &captive
	s.appendSample(sample)
	s.state.Update(func(sn *tui.Snapshot) { sn.Captive = captive })
}

// ---------- Whoami ----------

func (s *trackSession) whoamiLoop() {
	s.doWhoami()
	ticker := time.NewTicker(model.WhoamiInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
		s.doWhoami()
	}
}

func (s *trackSession) doWhoami() {
	w, err := s.api.Whoami(s.ctx)
	if err != nil {
		return
	}
	s.setNetToken(&w.NetToken)
	ipv := w.IPVersion
	s.state.Update(func(sn *tui.Snapshot) {
		sn.NetLabel = w.Label
		sn.NetAsn = w.Asn
		sn.NetAsName = w.AsName
		sn.IPVersion = ipv
	})
}

// ---------- Upload ----------

func (s *trackSession) uploadLoop() {
	ticker := time.NewTicker(model.BatchFlushInterval)
	defer ticker.Stop()
	backoff := time.Duration(0)
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		case <-s.flushNow:
		}
		if backoff > 0 {
			select {
			case <-time.After(backoff):
			case <-s.ctx.Done():
				return
			}
		}
		if err := s.flushBatch(); err != nil {
			if backoff == 0 {
				backoff = 5 * time.Second
			} else {
				backoff *= 2
			}
			if backoff > 2*time.Minute {
				backoff = 2 * time.Minute
			}
			s.state.Update(func(sn *tui.Snapshot) {
				sn.UploadStatus = fmt.Sprintf("Fehler, erneut in %s", backoff)
			})
			continue
		}
		backoff = 0
		n, _ := s.outbox.Count()
		s.state.Update(func(sn *tui.Snapshot) {
			sn.UploadStatus = "ok " + time.Now().Format("15:04:05")
			sn.OutboxPending = n
		})
	}
}

func (s *trackSession) flushBatch() error {
	pending, err := s.outbox.Peek(model.BatchMaxSamples)
	if err != nil {
		return err
	}
	if len(pending) == 0 {
		return nil
	}
	if _, err := s.api.PostSamples(s.ctx, s.trip.ID, model.SampleBatch{Samples: pending}, true); err != nil {
		return err
	}
	return s.outbox.RemoveFront(len(pending))
}

// ---------- Speedtest ----------

func (s *trackSession) autoSpeedtestLoop(every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
		s.runSpeedtest()
	}
}

func (s *trackSession) runSpeedtest() {
	s.state.Update(func(sn *tui.Snapshot) { sn.LastSpeedtest = "läuft..." })
	retryAfter, err := s.api.SpeedStart(s.ctx)
	if err != nil {
		s.state.Update(func(sn *tui.Snapshot) { sn.LastSpeedtest = fmt.Sprintf("Fehler: %v", err) })
		return
	}
	if retryAfter > 0 {
		s.state.Update(func(sn *tui.Snapshot) {
			sn.LastSpeedtest = fmt.Sprintf("Limit aktiv, bitte in %ds erneut versuchen", retryAfter)
		})
		return
	}
	idle := s.rttRing.Median()
	res := speedtest.Run(s.ctx, s.api)
	loaded := s.rttRing.Median()

	sample := s.buildSampleBase(model.SampleKindSpeedtest)
	sample.DownBps = res.DownBps
	sample.UpBps = res.UpBps
	sample.RttIdleMs = idle
	sample.RttLoadedMs = loaded
	durationMs := res.DurationMs
	sample.DurationMs = &durationMs
	s.appendSample(sample)

	summary := formatSpeedtestSummary(res.DownBps, res.UpBps, idle, loaded)
	s.state.Update(func(sn *tui.Snapshot) { sn.LastSpeedtest = summary })
}

func formatSpeedtestSummary(down, up, idle, loaded *float64) string {
	fmtMbps := func(v *float64) string {
		if v == nil {
			return "–"
		}
		return fmt.Sprintf("%.1f Mbit/s", *v/1_000_000)
	}
	fmtMs := func(v *float64) string {
		if v == nil {
			return "–"
		}
		return fmt.Sprintf("%.0fms", *v)
	}
	return fmt.Sprintf("%s ↓ / %s ↑  (RTT idle %s / unter Last %s)", fmtMbps(down), fmtMbps(up), fmtMs(idle), fmtMs(loaded))
}

// ---------- Live-Ansicht / Tastatur ----------

func (s *trackSession) renderLoop(kr *tui.KeyReader) {
	if s.flags.plain {
		<-s.ctx.Done()
		return
	}
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	first := true
	var keys <-chan rune
	if kr != nil {
		keys = kr.Keys()
	}
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			snap := s.state.Snap()
			if n, err := s.outbox.Count(); err == nil {
				snap.OutboxPending = n
			}
			tui.Render(os.Stdout, snap, first)
			first = false
		case r, ok := <-keys:
			if !ok {
				keys = nil
				continue
			}
			switch r {
			case 's', 'S':
				go s.runSpeedtest()
			case 'q', 'Q', 3: // Ctrl-C im Raw-Modus
				s.cancel()
			}
		}
	}
}

// ---------- Fahrtende ----------

func (s *trackSession) finish() error {
	// Letztes, ggf. unvollständiges Fenster abschließen.
	s.handleWindow(s.aggregator.Flush())

	cleanupCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Outbox möglichst vollständig leeren, bevor die Fahrt beendet wird.
	for {
		pending, err := s.outbox.Peek(model.BatchMaxSamples)
		if err != nil || len(pending) == 0 {
			break
		}
		if _, err := s.api.PostSamples(cleanupCtx, s.trip.ID, model.SampleBatch{Samples: pending}, true); err != nil {
			break
		}
		if err := s.outbox.RemoveFront(len(pending)); err != nil {
			break
		}
	}

	clockOffset := s.ws.ClockOffsetMs()
	_, endErr := s.api.EndTrip(cleanupCtx, s.trip.ID, model.TripEnd{ClockOffsetMs: &clockOffset})

	remaining, _ := s.outbox.Count()
	if remaining == 0 {
		s.outbox.Remove() //nolint:errcheck
	}

	fmt.Fprintln(os.Stderr)
	fmt.Fprintf(os.Stderr, "Fahrt %s beendet.\n", s.trip.ID)
	if endErr != nil {
		fmt.Fprintf(os.Stderr, "Warnung: Fahrtende konnte dem Server nicht gemeldet werden: %v\n", endErr)
	}
	if remaining > 0 {
		fmt.Fprintf(os.Stderr, "%d Messung(en) konnten nicht gesendet werden und werden beim nächsten Start von \"bahnnet track\" nachgesendet (%s).\n", remaining, s.outbox.Path())
	}
	return nil
}
