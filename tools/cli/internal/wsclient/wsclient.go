// Package wsclient verbindet sich mit WS /ws (Zeit-Sync + server-getriebene Pings),
// siehe docs/API.md und apps/web/src/lib/tracker für das Referenzverhalten im Browser.
package wsclient

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/treudler/bahnnet-cli/internal/model"
)

const (
	minBackoff = 1 * time.Second
	maxBackoff = 30 * time.Second
	// Anzahl Sync-Runden beim Verbindungsaufbau, Offset = Median der Messungen.
	syncRounds = 3
)

// Client hält eine WS-Verbindung zu /ws aufrecht (mit Reconnect-Backoff) und liefert
// empfangene RTTs sowie den Verbindungsstatus.
type Client struct {
	url   string
	debug bool

	onRtt     func(seq int, rttMs float64)
	onConnect func(connected bool)

	mu            sync.Mutex
	clockOffsetMs int64
	haveOffset    bool
	connected     bool
	cidCounter    int

	readyOnce sync.Once
	readyCh   chan struct{}
}

// New erzeugt einen Client für die gegebene wss://-URL.
func New(wsURL string, debug bool, onRtt func(seq int, rttMs float64), onConnect func(connected bool)) *Client {
	return &Client{url: wsURL, debug: debug, onRtt: onRtt, onConnect: onConnect, readyCh: make(chan struct{})}
}

// WaitReady blockiert, bis die erste Verbindung inkl. Zeit-Sync steht, der Kontext
// beendet wird oder das Timeout erreicht ist.
func (c *Client) WaitReady(ctx context.Context, timeout time.Duration) error {
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case <-c.readyCh:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return fmt.Errorf("Zeitüberschreitung beim Verbindungsaufbau zu %s", c.url)
	}
}

// ClockOffsetMs liefert den zuletzt per Zeit-Sync bestimmten Offset (0 falls noch keiner).
func (c *Client) ClockOffsetMs() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.clockOffsetMs
}

// Connected meldet, ob die WS-Verbindung aktuell steht.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

func (c *Client) setConnected(v bool) {
	c.mu.Lock()
	c.connected = v
	c.mu.Unlock()
	if v {
		c.readyOnce.Do(func() { close(c.readyCh) })
	}
	if c.onConnect != nil {
		c.onConnect(v)
	}
}

// Run hält die Verbindung aufrecht (Reconnect mit Backoff 1s→30s), bis ctx beendet wird.
// Fenster/Mess-Logik läuft beim Aufrufer unabhängig weiter (siehe stats.Aggregator);
// ein Disconnect bedeutet für die laufenden Fenster schlicht "keine RTTs empfangen".
func (c *Client) Run(ctx context.Context) {
	backoff := minBackoff
	for {
		if ctx.Err() != nil {
			return
		}
		err := c.runOnce(ctx)
		c.setConnected(false)
		if ctx.Err() != nil {
			return
		}
		if err != nil && c.debug {
			fmt.Fprintf(os.Stderr, "[debug] WS-Verbindung getrennt: %v (neuer Versuch in %s)\n", err, backoff)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func (c *Client) runOnce(ctx context.Context) error {
	conn, _, err := websocket.Dial(ctx, c.url, nil)
	if err != nil {
		return err
	}
	defer conn.CloseNow() //nolint:errcheck

	// Zeit-Sync: 3x sync senden, Median-Offset aus den Antworten bilden.
	offsets := make([]float64, 0, syncRounds)
	for i := 0; i < syncRounds; i++ {
		cid := c.nextCid()
		t0 := time.Now().UnixMilli()
		if err := c.sendJSON(ctx, conn, model.WsClientMessage{T: "sync", Cid: cid, T0: t0}); err != nil {
			return err
		}
		msg, err := c.readUntil(ctx, conn, "sync", cid)
		if err != nil {
			return err
		}
		t3 := time.Now().UnixMilli()
		// NTP-ähnliche Offset-Schätzung: ((t1-t0) + (t2-t3)) / 2.
		offset := float64((msg.T1-msg.T0)+(msg.T2-t3)) / 2
		offsets = append(offsets, offset)
	}
	sort.Float64s(offsets)
	medianOffset := offsets[len(offsets)/2]
	if len(offsets)%2 == 0 && len(offsets) > 0 {
		medianOffset = (offsets[len(offsets)/2-1] + offsets[len(offsets)/2]) / 2
	}
	c.mu.Lock()
	c.clockOffsetMs = int64(math.Round(medianOffset))
	c.haveOffset = true
	c.mu.Unlock()
	if c.debug {
		fmt.Fprintf(os.Stderr, "[debug] Zeit-Sync Offset: %dms\n", c.ClockOffsetMs())
	}

	c.setConnected(true)

	for {
		var raw json.RawMessage
		err := c.readJSON(ctx, conn, &raw)
		if err != nil {
			return err
		}
		var msg model.WsServerMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		switch msg.T {
		case "ping":
			if err := c.sendJSON(ctx, conn, model.WsClientMessage{T: "pong", Seq: msg.Seq}); err != nil {
				return err
			}
		case "rtt":
			if c.onRtt != nil {
				c.onRtt(msg.Seq, msg.RttMs)
			}
		case "hello", "sync":
			// hello: nur Begrüßung; sync außerhalb der Aufbauphase wird ignoriert.
		}
	}
}

func (c *Client) nextCid() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cidCounter++
	return c.cidCounter
}

func (c *Client) sendJSON(ctx context.Context, conn *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, data)
}

func (c *Client) readJSON(ctx context.Context, conn *websocket.Conn, out any) error {
	_, data, err := conn.Read(ctx)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// readUntil liest Nachrichten, bis eine mit passendem Typ+cid kommt (für den Sync-Handshake;
// zwischendurch können bereits ping-Frames eintreffen, die normal beantwortet werden).
func (c *Client) readUntil(ctx context.Context, conn *websocket.Conn, wantType string, cid int) (model.WsServerMessage, error) {
	for {
		var raw json.RawMessage
		if err := c.readJSON(ctx, conn, &raw); err != nil {
			return model.WsServerMessage{}, err
		}
		var msg model.WsServerMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if msg.T == wantType && msg.Cid == cid {
			return msg, nil
		}
		if msg.T == "ping" {
			if err := c.sendJSON(ctx, conn, model.WsClientMessage{T: "pong", Seq: msg.Seq}); err != nil {
				return model.WsServerMessage{}, err
			}
		}
	}
}
