package iceportal

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"
)

const (
	statusPollInterval = 5 * time.Second
	tripPollInterval   = 60 * time.Second
	// Bei Nichterreichbarkeit wird seltener erneut versucht.
	unavailableRetryInterval = 30 * time.Second
)

// Poller fragt Status und Fahrplan periodisch im Hintergrund ab und hält jeweils den
// letzten erfolgreichen Stand vor. Nicht erreichbar → "nicht verfügbar", weiter
// Versuche alle 30 s (siehe PLANUNG.md 6.6 / Aufgabenbeschreibung).
type Poller struct {
	client *Client
	debug  bool

	mu              sync.RWMutex
	status          *Status
	statusAvailable bool
	trip            *TripInfo
	tripAvailable   bool

	statusPrinted bool
	tripPrinted   bool
	printMu       sync.Mutex
}

// NewPoller erzeugt einen Poller für den gegebenen Basis-URL.
func NewPoller(baseURL string, debug bool) *Poller {
	return &Poller{client: New(baseURL), debug: debug}
}

// Start startet die Hintergrund-Polling-Schleifen (Status alle 5s, Trip alle 60s,
// bei Fehlern alle 30s), bis ctx beendet wird.
func (p *Poller) Start(ctx context.Context) {
	go p.runLoop(ctx, "status", statusPollInterval, func(c context.Context) error {
		st, err := p.client.FetchStatus(c)
		if err != nil {
			p.mu.Lock()
			p.statusAvailable = false
			p.mu.Unlock()
			return err
		}
		p.debugPrintOnce(&p.statusPrinted, "status", st.Raw)
		p.mu.Lock()
		p.status = st
		p.statusAvailable = true
		p.mu.Unlock()
		return nil
	})
	go p.runLoop(ctx, "trip", tripPollInterval, func(c context.Context) error {
		ti, err := p.client.FetchTripInfo(c)
		if err != nil {
			p.mu.Lock()
			p.tripAvailable = false
			p.mu.Unlock()
			return err
		}
		p.debugPrintOnce(&p.tripPrinted, "tripInfo", ti.Raw)
		p.mu.Lock()
		p.trip = ti
		p.tripAvailable = true
		p.mu.Unlock()
		return nil
	})
}

func (p *Poller) debugPrintOnce(flag *bool, label, raw string) {
	if !p.debug {
		return
	}
	p.printMu.Lock()
	defer p.printMu.Unlock()
	if *flag {
		return
	}
	*flag = true
	fmt.Fprintf(os.Stderr, "[debug] ICE-Portal %s Rohantwort: %s\n", label, raw)
}

func (p *Poller) runLoop(ctx context.Context, _ string, normalInterval time.Duration, fetch func(context.Context) error) {
	interval := time.Duration(0)
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
		if err := fetch(ctx); err != nil {
			interval = unavailableRetryInterval
			continue
		}
		interval = normalInterval
	}
}

// Status liefert den letzten erfolgreich abgefragten Status und ob der Provider aktuell
// als verfügbar gilt.
func (p *Poller) Status() (*Status, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.status, p.statusAvailable
}

// Trip liefert die letzte erfolgreich abgefragte Fahrplan-Info und Verfügbarkeit.
func (p *Poller) Trip() (*TripInfo, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.trip, p.tripAvailable
}

// FreshStatus liefert den Status nur, wenn er nicht älter als maxAge ist (siehe
// Positionsregel: ICE-Portal-Status jünger als 15s sonst posSource=none).
func (p *Poller) FreshStatus(maxAge time.Duration) *Status {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.status == nil {
		return nil
	}
	if time.Since(p.status.FetchedAt) > maxAge {
		return nil
	}
	return p.status
}
