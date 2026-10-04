package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/treudler/bahnping-cli/internal/apiclient"
	"github.com/treudler/bahnping-cli/internal/iceportal"
	"github.com/treudler/bahnping-cli/internal/model"
	"github.com/treudler/bahnping-cli/internal/outbox"
	"github.com/treudler/bahnping-cli/internal/speedtest"
	"github.com/treudler/bahnping-cli/internal/stats"
	"github.com/treudler/bahnping-cli/internal/tui"
	"github.com/treudler/bahnping-cli/internal/wsclient"
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
	wg         *sync.WaitGroup

	flushNow chan struct{}

	netMu    sync.Mutex
	netToken *model.NetToken

	// speedtestRunning verhindert parallele Speedtests aus Taste "s", --speedtest-every und
	// Dauer-Modus: läuft schon einer, wird ein neuer Aufruf einfach übersprungen.
	speedtestRunning atomic.Bool
	// continuous schaltet den Dauer-Speedtest-Modus (Taste "c" / --speedtest-continuous) um.
	// continuousGen erhöht sich bei jedem Umschalten, damit eine alte Schleife nach schnellem
	// Aus/An nicht neben der neuen weiterläuft.
	continuous    atomic.Bool
	continuousGen atomic.Int64

	winMu            sync.Mutex
	recentWindows    []stats.WindowResult
	windowsTotal     int
	windowsWithReply int
}

func newTrackSession(ctx context.Context, cancel context.CancelFunc) *trackSession {
	return &trackSession{ctx: ctx, cancel: cancel, flushNow: make(chan struct{}, 1)}
}

// ---------- Position / Netz für Samples ----------

// positionFields liefert Position/Tempo aus dem (frischen) Portal-Status; mit --no-position nichts.
func (s *trackSession) positionFields(st *iceportal.Status) (lat, lon, speedMps *float64, posSource string) {
	if s.flags.noPosition || st == nil || st.Latitude == nil || st.Longitude == nil {
		return nil, nil, nil, "none"
	}
	return st.Latitude, st.Longitude, st.SpeedMps(), "iceportal"
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
	// Der Konnektivitätsstatus (inkl. Prognose) wird auch mit --no-position mitgeschickt –
	// er verrät keine Position, nur was das Portal gerade meldet.
	st := s.poller.FreshStatus(positionMaxAge)
	lat, lon, speedMps, posSource := s.positionFields(st)
	var internet *string
	if st != nil {
		internet = st.Internet
	}
	return model.Sample{
		ID:            model.NewID(),
		Ts:            time.Now().UnixMilli(),
		Lat:           lat,
		Lon:           lon,
		AccuracyM:     nil,
		SpeedMps:      speedMps,
		Heading:       nil,
		Net:           s.currentNetToken(),
		IceState:      st.IceState(),
		IceNextState:  st.IceNextState(),
		IceRemainingS: st.IceRemainingS(),
		IceInternet:   internet,
		PosSource:     posSource,
		Kind:          kind,
	}
}

// ---------- Fahrt-Zusatzdaten und Halte aus dem ICE-Portal ----------

const tripMetaSyncInterval = 10 * time.Second

func msToRFC3339(ms *int64) *string {
	if ms == nil || *ms <= 0 {
		return nil
	}
	v := time.UnixMilli(*ms).UTC().Format(time.RFC3339)
	return &v
}

// buildTripMeta leitet die Fahrt-Zusatzdaten (Triebzug, Baureihe, Fahrplantag, Start/Ziel) aus
// Status und Fahrplan ab. Zugnummer/Gattung bleiben bewusst außen vor (siehe patchTrainNumberWhenKnown).
func buildTripMeta(st *iceportal.Status, ti *iceportal.TripInfo) model.TripUpdate {
	var upd model.TripUpdate
	if st != nil {
		upd.IceTzn = st.Tzn
		upd.IceSeries = st.Series
	}
	if ti != nil {
		upd.TripDate = ti.TripDate
		if len(ti.Stops) > 0 && ti.Stops[0].StationName != nil {
			upd.OriginName = ti.Stops[0].StationName
		}
		if ti.FinalStationName != nil {
			upd.DestinationName = ti.FinalStationName
		} else if n := len(ti.Stops); n > 0 && ti.Stops[n-1].StationName != nil {
			upd.DestinationName = ti.Stops[n-1].StationName
		}
	}
	return upd
}

// buildStops wandelt den Portal-Fahrplan in den API-Vertrag (TripStop) um; Halte ohne Namen entfallen.
func buildStops(ti *iceportal.TripInfo) []model.TripStop {
	if ti == nil {
		return nil
	}
	out := make([]model.TripStop, 0, len(ti.Stops))
	for i, s := range ti.Stops {
		if s.StationName == nil {
			continue
		}
		out = append(out, model.TripStop{
			Seq:                i,
			EvaNr:              s.EvaNr,
			Name:               *s.StationName,
			Lat:                s.Latitude,
			Lon:                s.Longitude,
			ScheduledArrival:   msToRFC3339(s.ScheduledArrivalTimeMs),
			ActualArrival:      msToRFC3339(s.ActualArrivalTimeMs),
			ScheduledDeparture: msToRFC3339(s.ScheduledDepartureTimeMs),
			ActualDeparture:    msToRFC3339(s.ActualDepartureTimeMs),
			TrackScheduled:     s.TrackScheduled,
			TrackActual:        s.TrackActual,
			Passed:             s.Passed,
			PositionStatus:     s.PositionStatus,
		})
	}
	return out
}

func fingerprint(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// tripMetaSyncLoop schickt Zusatzdaten (PATCH) und Halteliste (PUT) an den Server, sobald sich
// etwas ändert – so bleibt die Verspätungsentwicklung je Halt erhalten. Ältere Server ohne die
// Halte-Route (404) werden einmal erkannt und danach nicht mehr behelligt.
func (s *trackSession) tripMetaSyncLoop() {
	ticker := time.NewTicker(tripMetaSyncInterval)
	defer ticker.Stop()
	var lastMeta, lastStops string
	stopsUnsupported := false
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
		}
		st, _ := s.poller.Status()
		ti, _ := s.poller.Trip()

		upd := buildTripMeta(st, ti)
		if fp := fingerprint(upd); fp != "{}" && fp != lastMeta {
			if _, err := s.api.PatchTrip(s.ctx, s.trip.ID, upd); err == nil {
				lastMeta = fp
			} else if s.flags.debug {
				fmt.Fprintf(os.Stderr, "[debug] PATCH Fahrt-Zusatzdaten fehlgeschlagen: %v\r\n", err)
			}
		}

		if stopsUnsupported {
			continue
		}
		stops := buildStops(ti)
		if len(stops) == 0 {
			continue
		}
		if fp := fingerprint(stops); fp != lastStops {
			err := s.api.PutStops(s.ctx, s.trip.ID, model.TripStopsPut{Stops: stops})
			switch {
			case err == nil:
				lastStops = fp
			case apiclient.IsNotFound(err):
				stopsUnsupported = true
				if s.flags.debug {
					fmt.Fprint(os.Stderr, "[debug] Server kennt PUT /api/trips/:id/stops nicht, Halte werden nicht gesendet.\r\n")
				}
			default:
				if s.flags.debug {
					fmt.Fprintf(os.Stderr, "[debug] PUT Halte fehlgeschlagen: %v\r\n", err)
				}
			}
		}
	}
}

func (s *trackSession) appendSample(sample model.Sample) {
	if err := s.outbox.Append(sample); err != nil {
		if s.flags.debug {
			fmt.Fprintf(os.Stderr, "[debug] Outbox-Fehler: %v\r\n", err)
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
			sn.IceNextState = ""
			sn.IceRemainingS = nil
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
		sn.IceNextState = ""
		if next := st.IceNextState(); next != nil {
			sn.IceNextState = *next
		}
		sn.IceRemainingS = st.IceRemainingS()
		sn.IceTzn, sn.IceSeries = "", ""
		if st.Tzn != nil {
			sn.IceTzn = *st.Tzn
		}
		if st.Series != nil {
			sn.IceSeries = *st.Series
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

// runSpeedtest führt genau einen Speedtest aus. Läuft bereits einer (aus Taste "s",
// --speedtest-every oder dem Dauer-Modus), wird dieser Aufruf übersprungen.
func (s *trackSession) runSpeedtest() {
	if !s.speedtestRunning.CompareAndSwap(false, true) {
		return
	}
	defer s.speedtestRunning.Store(false)

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

// toggleContinuousSpeedtest schaltet den Dauer-Speedtest-Modus um (Taste "c" bzw. beim Start
// über --speedtest-continuous). Jedes Einschalten startet eine Schleife mit neuer Generation;
// eine ältere Schleife beendet sich nach ihrem aktuellen Test selbst.
func (s *trackSession) toggleContinuousSpeedtest() {
	on := !s.continuous.Load()
	s.continuous.Store(on)
	gen := s.continuousGen.Add(1)
	s.state.Update(func(sn *tui.Snapshot) { sn.SpeedtestContinuous = on })
	if on {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.continuousSpeedtestLoop(gen)
		}()
	}
}

// continuousSpeedtestLoop führt Speedtests aus, solange ihre Generation aktuell ist und die
// Fahrt läuft, mit SpeedtestContinuousPause dazwischen. Läuft gerade ein Test (Taste "s" oder
// alte Schleife), wird dieser Durchgang übersprungen.
func (s *trackSession) continuousSpeedtestLoop(gen int64) {
	for s.continuousGen.Load() == gen && s.ctx.Err() == nil {
		s.runSpeedtest()
		if s.continuousGen.Load() != gen {
			return
		}
		select {
		case <-s.ctx.Done():
			return
		case <-time.After(model.SpeedtestContinuousPause):
		}
	}
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
			case 'c', 'C':
				s.toggleContinuousSpeedtest()
			case 'q', 'Q', 3: // Ctrl-C im Raw-Modus
				s.cancel()
			}
		}
	}
}

// ---------- Fahrtende ----------

func (s *trackSession) finish() error {
	// Letztes, unvollständiges Fenster abschließen – aber nur, wenn darin schon Antworten liegen
	// (ein angebrochenes Fenster ohne Ping ist kein Verlust).
	if s.aggregator.Pending() {
		s.handleWindow(s.aggregator.Flush())
	}

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

	fmt.Fprint(os.Stderr, "\r\n")
	fmt.Fprintf(os.Stderr, "Fahrt %s beendet.\r\n", s.trip.ID)
	if endErr != nil {
		fmt.Fprintf(os.Stderr, "Warnung: Fahrtende konnte dem Server nicht gemeldet werden: %v\r\n", endErr)
	}
	if remaining > 0 {
		fmt.Fprintf(os.Stderr, "%d Messung(en) konnten nicht gesendet werden und werden beim nächsten Start von \"bahnping track\" nachgesendet (%s).\r\n", remaining, s.outbox.Path())
	}
	return nil
}
