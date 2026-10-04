package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/treudler/bahnping-cli/internal/apiclient"
	"github.com/treudler/bahnping-cli/internal/config"
	"github.com/treudler/bahnping-cli/internal/iceportal"
	"github.com/treudler/bahnping-cli/internal/model"
	"github.com/treudler/bahnping-cli/internal/outbox"
	"github.com/treudler/bahnping-cli/internal/stats"
	"github.com/treudler/bahnping-cli/internal/tui"
	"github.com/treudler/bahnping-cli/internal/wsclient"
)

// trackFlags fasst die Optionen von "bahnping track" zusammen.
type trackFlags struct {
	train          string
	number         string
	speedtestEvery time.Duration
	noPosition     bool
	icePortalURL   string
	plain          bool
	debug          bool
}

func parseTrackFlags(args []string) (*trackFlags, error) {
	fs := flag.NewFlagSet("track", flag.ContinueOnError)
	f := &trackFlags{}
	fs.StringVar(&f.train, "train", "", "Zugtyp: ice|ic|regio|sbahn|other")
	fs.StringVar(&f.number, "number", "", `Zugnummer, z.B. "ICE 599"`)
	fs.DurationVar(&f.speedtestEvery, "speedtest-every", 0, "Automatischer Speedtest in diesem Abstand, z.B. 10m")
	fs.BoolVar(&f.noPosition, "no-position", false, "Keine Position senden (immer posSource=none)")
	fs.StringVar(&f.icePortalURL, "iceportal-url", iceportal.DefaultBaseURL, "ICE-Portal-Basis-URL (für Tests mit Mock)")
	fs.BoolVar(&f.plain, "plain", false, "Eine Log-Zeile pro Fenster statt Live-Ansicht")
	fs.BoolVar(&f.debug, "debug", false, "Rohantworten/Verbindungsdetails ausgeben")
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	return f, nil
}

func validTrainType(s string) (model.TrainType, bool) {
	switch model.TrainType(s) {
	case model.TrainTypeICE, model.TrainTypeIC, model.TrainTypeRegio, model.TrainTypeSBahn, model.TrainTypeOther:
		return model.TrainType(s), true
	}
	return "", false
}

func cmdTrack(args []string) error {
	flags, err := parseTrackFlags(args)
	if err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if cfg == nil {
		return fmt.Errorf(`nicht angemeldet, bitte zuerst "bahnping login <server-url>" ausführen`)
	}

	api := apiclient.New(cfg.Server, cfg.Token)
	stateDir, err := config.StateDir()
	if err != nil {
		return err
	}

	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	// runCtx kann zusätzlich zum Signal-Kontext auch durch die Taste "q" beendet werden
	// (siehe trackSession.renderLoop). Für die Aufräumarbeiten in finish() wird bewusst ein
	// eigener, unabhängiger Kontext verwendet, da runCtx dann schon beendet ist.
	runCtx, cancelRun := context.WithCancel(sigCtx)
	defer cancelRun()

	// Reste aus einem vorherigen, nicht sauber beendeten Lauf nachsenden (nicht blockierend
	// für den Start einer neuen Fahrt, aber best-effort vor dem Hochfahren der neuen Outbox).
	resendLeftoverOutboxes(runCtx, api, stateDir, flags.debug)

	// Kurzer, einmaliger ICE-Portal-Check vor dem Fahrt-Start, um Zugtyp/-nummer zu bestimmen,
	// falls nicht per Flag gesetzt (siehe Aufgabenbeschreibung: "trainType aus Flag, sonst aus
	// ICE-Portal wenn verfügbar, sonst interaktive Auswahl").
	iceClient := iceportal.New(flags.icePortalURL)
	quickCtx, quickCancel := context.WithTimeout(runCtx, 3*time.Second)
	quickTrip, _ := iceClient.FetchTripInfo(quickCtx)
	quickCancel()

	trainType, err := resolveTrainType(runCtx, flags.train, quickTrip)
	if err != nil {
		return err
	}
	trainNumber := resolveTrainNumber(flags.number, quickTrip, trainType)

	platform := fmt.Sprintf("cli-%s-%s", runtime.GOOS, runtime.GOARCH)

	// Live-Ansicht / Tastatur vorbereiten.
	state := tui.NewState()
	state.Update(func(s *tui.Snapshot) {
		s.TrainLabel = trainLabel(trainType, trainNumber)
	})

	var keyReader *tui.KeyReader
	if !flags.plain {
		keyReader, err = tui.NewKeyReader()
		if err != nil && flags.debug {
			fmt.Fprintf(os.Stderr, "[debug] Tastatursteuerung nicht verfügbar: %v\r\n", err)
		}
	}
	if keyReader != nil {
		defer keyReader.Close() //nolint:errcheck
	}

	rttRing := stats.NewRttRing(5)
	aggregator := &stats.Aggregator{}

	onRtt := func(seq int, rttMs float64) {
		aggregator.AddRtt(seq, rttMs)
		rttRing.Add(rttMs)
		state.AddRtt(rttMs)
	}
	onConnect := func(connected bool) {
		state.Update(func(s *tui.Snapshot) { s.ConnectedWS = connected })
	}

	wsURL, err := api.WSURL()
	if err != nil {
		return err
	}
	ws := wsclient.New(wsURL, flags.debug, onRtt, onConnect)
	go ws.Run(runCtx)
	if err := ws.WaitReady(runCtx, 10*time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "Warnung: WS-Zeit-Sync beim Start fehlgeschlagen (%v), Fahrt startet trotzdem.\r\n", err)
	}
	clockOffset := ws.ClockOffsetMs()

	trip, err := api.CreateTrip(runCtx, model.TripCreate{
		TrainType:     trainType,
		TrainNumber:   trainNumber,
		Platform:      platform,
		ClockOffsetMs: &clockOffset,
	})
	if err != nil {
		return fmt.Errorf("Fahrt konnte nicht angelegt werden: %w", err)
	}
	fmt.Fprintf(os.Stderr, "Fahrt %s gestartet (%s).\r\n", trip.ID, trainLabel(trainType, trainNumber))

	state.Update(func(s *tui.Snapshot) {
		s.TripID = trip.ID
		s.StartedAt = time.Now()
	})

	ob, err := outbox.Open(stateDir, trip.ID)
	if err != nil {
		return err
	}

	poller := iceportal.NewPoller(flags.icePortalURL, flags.debug)
	poller.Start(runCtx)

	// Falls die Zugnummer erst jetzt (oder später) aus dem Portal bekannt wird, nachträglich
	// per PATCH korrigieren – Route existiert serverseitig evtl. noch nicht, siehe patchTrainNumberWhenKnown.
	go patchTrainNumberWhenKnown(runCtx, api, trip.ID, trainNumber, poller, flags.debug, state)

	sess := newTrackSession(runCtx, cancelRun)
	sess.api = api
	sess.trip = trip
	sess.trainType = trainType
	sess.outbox = ob
	sess.poller = poller
	sess.ws = ws
	sess.aggregator = aggregator
	sess.rttRing = rttRing
	sess.state = state
	sess.flags = flags

	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); sess.pingWindowLoop() }()
	wg.Add(1)
	go func() { defer wg.Done(); sess.probeLoop() }()
	wg.Add(1)
	go func() { defer wg.Done(); sess.whoamiLoop() }()
	wg.Add(1)
	go func() { defer wg.Done(); sess.uploadLoop() }()
	wg.Add(1)
	go func() { defer wg.Done(); sess.icePortalDisplayLoop() }()
	wg.Add(1)
	go func() { defer wg.Done(); sess.tripMetaSyncLoop() }()
	if flags.speedtestEvery > 0 {
		wg.Add(1)
		go func() { defer wg.Done(); sess.autoSpeedtestLoop(flags.speedtestEvery) }()
	}

	renderDone := make(chan struct{})
	go func() { defer close(renderDone); sess.renderLoop(keyReader) }()

	<-runCtx.Done()
	<-renderDone
	wg.Wait()

	return sess.finish()
}

// trainLabel liefert die Zugnummer, falls bekannt, sonst das Label des Zugtyps.
func trainLabel(t model.TrainType, number string) string {
	if number != "" {
		return number
	}
	if label, ok := model.TrainTypeLabels[t]; ok {
		return label
	}
	return string(t)
}

func resolveTrainType(ctx context.Context, flagTrain string, trip *iceportal.TripInfo) (model.TrainType, error) {
	if flagTrain != "" {
		tt, ok := validTrainType(strings.ToLower(flagTrain))
		if !ok {
			return "", fmt.Errorf("ungültiger Zugtyp %q (erlaubt: ice, ic, regio, sbahn, other)", flagTrain)
		}
		return tt, nil
	}
	if trip != nil && trip.TrainType != nil {
		if tt := mapIcePortalTrainType(*trip.TrainType); tt != "" {
			return tt, nil
		}
	}
	return promptTrainType(ctx)
}

func mapIcePortalTrainType(raw string) model.TrainType {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "ICE":
		return model.TrainTypeICE
	case "IC", "EC":
		return model.TrainTypeIC
	case "RE", "RB":
		return model.TrainTypeRegio
	case "S":
		return model.TrainTypeSBahn
	case "":
		return ""
	default:
		return model.TrainTypeOther
	}
}

func promptTrainType(ctx context.Context) (model.TrainType, error) {
	fmt.Println("Zugtyp konnte nicht automatisch bestimmt werden. Bitte auswählen:")
	fmt.Println("  [1] ICE   [2] IC/EC   [3] RE/RB   [4] S-Bahn   [5] Sonstiges")
	fmt.Print("Auswahl: ")
	// Eingabe in eigener Goroutine lesen, damit Strg-C (ctx) die Abfrage sofort abbricht.
	lineCh := make(chan string, 1)
	go func() {
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		lineCh <- line
	}()
	var line string
	select {
	case <-ctx.Done():
		fmt.Println()
		return "", fmt.Errorf("abgebrochen")
	case line = <-lineCh:
	}
	switch strings.TrimSpace(line) {
	case "1":
		return model.TrainTypeICE, nil
	case "2":
		return model.TrainTypeIC, nil
	case "3":
		return model.TrainTypeRegio, nil
	case "4":
		return model.TrainTypeSBahn, nil
	case "5", "":
		return model.TrainTypeOther, nil
	default:
		return model.TrainTypeOther, nil
	}
}

func resolveTrainNumber(flagNumber string, trip *iceportal.TripInfo, trainType model.TrainType) string {
	if flagNumber != "" {
		return flagNumber
	}
	if trip != nil && trip.Vzn != nil && *trip.Vzn != "" {
		prefix := strings.ToUpper(string(trainType))
		if trip.TrainType != nil && *trip.TrainType != "" {
			prefix = *trip.TrainType
		}
		return prefix + " " + *trip.Vzn
	}
	return ""
}

// patchTrainNumberWhenKnown wartet, bis der ICE-Portal-Poller eine Zugnummer liefert
// (falls beim Start noch keine bekannt war), und schickt sie per PATCH /api/trips/:id nach.
// Die Route existiert serverseitig evtl. noch nicht (404) – dann wird einmalig gewarnt
// und nicht erneut versucht.
func patchTrainNumberWhenKnown(ctx context.Context, api *apiclient.Client, tripID, alreadyKnown string, poller *iceportal.Poller, debug bool, state *tui.State) {
	if alreadyKnown != "" {
		return
	}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	warned404 := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		trip, ok := poller.Trip()
		if !ok || trip == nil || trip.Vzn == nil || *trip.Vzn == "" {
			continue
		}
		number := resolveTrainNumber("", trip, "")
		if number == "" {
			continue
		}
		_, err := api.PatchTrip(ctx, tripID, model.TripUpdate{TrainNumber: &number})
		if err != nil {
			if apiclient.IsNotFound(err) {
				if !warned404 && debug {
					fmt.Fprint(os.Stderr, "[debug] PATCH /api/trips/:id liefert 404 (Route evtl. noch nicht vorhanden), Zugnummer wird nicht nachgetragen.", "\r\n")
				}
				warned404 = true
				continue // weiter versuchen schadet nicht, aber nicht erneut warnen
			}
			continue
		}
		state.Update(func(s *tui.Snapshot) { s.TrainLabel = number })
		return
	}
}

// resendLeftoverOutboxes versucht beim Start, Outbox-Dateien aus vorherigen, nicht
// sauber beendeten Läufen zu leeren (siehe PLANUNG.md 6.8: "Upload läuft beim nächsten
// Öffnen weiter"). Fehler werden nur als Hinweis ausgegeben, blockieren den neuen
// Fahrt-Start aber nicht lange (ein Versuch je Datei).
func resendLeftoverOutboxes(ctx context.Context, api *apiclient.Client, stateDir string, debug bool) {
	paths, err := outbox.FindExisting(stateDir)
	if err != nil || len(paths) == 0 {
		return
	}
	for _, path := range paths {
		tripID := tripIDFromOutboxPath(path)
		if tripID == "" {
			continue
		}
		ob, err := outbox.Open(stateDir, tripID)
		if err != nil {
			continue
		}
		n, err := ob.Count()
		if err != nil || n == 0 {
			continue
		}
		fmt.Fprintf(os.Stderr, "Sende %d gepufferte Messung(en) einer vorherigen Fahrt (%s) nach...\r\n", n, tripID)
		sent := flushOnce(ctx, api, ob, tripID)
		if sent < n {
			fmt.Fprintf(os.Stderr, "  %d/%d gesendet, Rest wird beim nächsten Start erneut versucht.\r\n", sent, n)
		} else {
			fmt.Fprint(os.Stderr, "  erledigt.", "\r\n")
		}
		if debug {
			fmt.Fprintf(os.Stderr, "[debug] Outbox-Datei: %s\r\n", path)
		}
	}
}

func tripIDFromOutboxPath(path string) string {
	base := path
	if idx := strings.LastIndexByte(base, '/'); idx >= 0 {
		base = base[idx+1:]
	}
	base = strings.TrimPrefix(base, "outbox-")
	base = strings.TrimSuffix(base, ".jsonl")
	return base
}

// flushOnce sendet so viele Batches wie möglich (bis die Outbox leer ist oder ein Fehler
// auftritt) und liefert die Gesamtzahl der erfolgreich übermittelten Samples.
func flushOnce(ctx context.Context, api *apiclient.Client, ob *outbox.Outbox, tripID string) int {
	total := 0
	for {
		pending, err := ob.Peek(model.BatchMaxSamples)
		if err != nil || len(pending) == 0 {
			return total
		}
		resp, err := api.PostSamples(ctx, tripID, model.SampleBatch{Samples: pending}, true)
		if err != nil {
			return total
		}
		if err := ob.RemoveFront(len(pending)); err != nil {
			return total
		}
		total += resp.Accepted + resp.Duplicates + resp.Rejected
		if len(pending) < model.BatchMaxSamples {
			return total
		}
	}
}
