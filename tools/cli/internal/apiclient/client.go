// Package apiclient spricht den HTTP-Teil des API-Vertrags aus docs/API.md.
package apiclient

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/treudler/bahnnet-cli/internal/model"
)

// Client ist ein einfacher REST-Client für die bahn-netzwerk-tracker-API.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// New erzeugt einen Client. baseURL ohne abschließenden Slash (z.B. "http://127.0.0.1:4100").
func New(baseURL, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: 15 * time.Second},
	}
}

// APIError transportiert ein RFC-9457-Problem oder einen reinen Statuscode.
type APIError struct {
	Status int
	Title  string
	Detail string
}

func (e *APIError) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("%d %s: %s", e.Status, e.Title, e.Detail)
	}
	return fmt.Sprintf("%d %s", e.Status, e.Title)
}

// IsNotFound prüft, ob ein Fehler ein HTTP 404 ist (z.B. Route noch nicht vorhanden).
func IsNotFound(err error) bool {
	apiErr, ok := err.(*APIError)
	return ok && apiErr.Status == 404
}

func (c *Client) newRequest(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	return req, nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, reqBody any, out any) error {
	var bodyReader io.Reader
	if reqBody != nil {
		data, err := json.Marshal(reqBody)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(data)
	}
	req, err := c.newRequest(ctx, method, path, bodyReader)
	if err != nil {
		return err
	}
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		return parseProblem(resp.StatusCode, data)
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("Antwort konnte nicht gelesen werden: %w", err)
		}
	}
	return nil
}

func parseProblem(status int, data []byte) error {
	var p model.Problem
	if err := json.Unmarshal(data, &p); err == nil && p.Title != "" {
		return &APIError{Status: status, Title: p.Title, Detail: p.Detail}
	}
	return &APIError{Status: status, Title: http.StatusText(status), Detail: strings.TrimSpace(string(data))}
}

// Me prüft/liest GET /api/me.
func (c *Client) Me(ctx context.Context) (*model.Me, error) {
	var me model.Me
	if err := c.doJSON(ctx, http.MethodGet, "/api/me", nil, &me); err != nil {
		return nil, err
	}
	return &me, nil
}

// Whoami ruft GET /api/net/whoami ab.
func (c *Client) Whoami(ctx context.Context) (*model.WhoamiResponse, error) {
	var w model.WhoamiResponse
	if err := c.doJSON(ctx, http.MethodGet, "/api/net/whoami", nil, &w); err != nil {
		return nil, err
	}
	return &w, nil
}

// ProbeResult ist das Ergebnis einer Captive-Portal-Probe.
type ProbeResult struct {
	HTTPMs  float64
	Ok      bool
	Captive bool
}

// Probe ruft GET /api/net/probe ab und misst die Dauer. Captive = true, falls eine Antwort
// kam, deren Body nicht exakt dem erwarteten PROBE_BODY entspricht.
func (c *Client) Probe(ctx context.Context) ProbeResult {
	start := time.Now()
	req, err := c.newRequest(ctx, http.MethodGet, "/api/net/probe", nil)
	if err != nil {
		return ProbeResult{Ok: false, Captive: false}
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return ProbeResult{Ok: false, Captive: false}
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	elapsed := float64(time.Since(start).Microseconds()) / 1000.0
	if err != nil {
		return ProbeResult{HTTPMs: elapsed, Ok: false, Captive: true}
	}
	captive := string(data) != model.ProbeBody
	return ProbeResult{HTTPMs: elapsed, Ok: true, Captive: captive}
}

// CreateTrip ruft POST /api/trips ab.
func (c *Client) CreateTrip(ctx context.Context, body model.TripCreate) (*model.Trip, error) {
	var trip model.Trip
	if err := c.doJSON(ctx, http.MethodPost, "/api/trips", body, &trip); err != nil {
		return nil, err
	}
	return &trip, nil
}

// PatchTrip ruft PATCH /api/trips/:id ab. Die Route kann (Stand dieser Implementierung)
// serverseitig noch fehlen; in diesem Fall liefert PatchTrip einen *APIError mit Status 404,
// den der Aufrufer mit IsNotFound() erkennen und als Warnung behandeln kann.
func (c *Client) PatchTrip(ctx context.Context, id string, body model.TripUpdate) (*model.Trip, error) {
	var trip model.Trip
	if err := c.doJSON(ctx, http.MethodPatch, "/api/trips/"+url.PathEscape(id), body, &trip); err != nil {
		return nil, err
	}
	return &trip, nil
}

// EndTrip ruft POST /api/trips/:id/end ab.
func (c *Client) EndTrip(ctx context.Context, id string, body model.TripEnd) (*model.Trip, error) {
	var trip model.Trip
	if err := c.doJSON(ctx, http.MethodPost, "/api/trips/"+url.PathEscape(id)+"/end", body, &trip); err != nil {
		return nil, err
	}
	return &trip, nil
}

// PostSamples ruft POST /api/trips/:id/samples ab, optional gzip-komprimiert.
func (c *Client) PostSamples(ctx context.Context, id string, batch model.SampleBatch, gzipBody bool) (*model.SampleBatchResponse, error) {
	data, err := json.Marshal(batch)
	if err != nil {
		return nil, err
	}
	var bodyReader io.Reader
	if gzipBody {
		var buf bytes.Buffer
		gw := gzip.NewWriter(&buf)
		if _, err := gw.Write(data); err != nil {
			return nil, err
		}
		if err := gw.Close(); err != nil {
			return nil, err
		}
		bodyReader = &buf
	} else {
		bodyReader = bytes.NewReader(data)
	}
	req, err := c.newRequest(ctx, http.MethodPost, "/api/trips/"+url.PathEscape(id)+"/samples", bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if gzipBody {
		req.Header.Set("Content-Encoding", "gzip")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, parseProblem(resp.StatusCode, respData)
	}
	var out model.SampleBatchResponse
	if err := json.Unmarshal(respData, &out); err != nil {
		return nil, fmt.Errorf("Antwort konnte nicht gelesen werden: %w", err)
	}
	return &out, nil
}

// SpeedStart ruft POST /api/speed/start ab. Bei 429 wird retryAfterSeconds > 0 geliefert.
func (c *Client) SpeedStart(ctx context.Context) (retryAfterSeconds int, err error) {
	req, err := c.newRequest(ctx, http.MethodPost, "/api/speed/start", nil)
	if err != nil {
		return 0, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck
	if resp.StatusCode == http.StatusTooManyRequests {
		ra, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
		return ra, nil
	}
	if resp.StatusCode >= 400 {
		return 0, &APIError{Status: resp.StatusCode, Title: http.StatusText(resp.StatusCode)}
	}
	return 0, nil
}

// SpeedDown öffnet GET /api/speed/down?bytes=N als Stream; der Aufrufer muss den Body schließen.
func (c *Client) SpeedDown(ctx context.Context, bytesN int) (io.ReadCloser, error) {
	req, err := c.newRequest(ctx, http.MethodGet, "/api/speed/down?bytes="+strconv.Itoa(bytesN), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		data, _ := io.ReadAll(resp.Body)
		return nil, parseProblem(resp.StatusCode, data)
	}
	return resp.Body, nil
}

// SpeedUp sendet POST /api/speed/up mit dem gegebenen Reader als octet-stream.
func (c *Client) SpeedUp(ctx context.Context, body io.Reader, contentLength int64) error {
	req, err := c.newRequest(ctx, http.MethodPost, "/api/speed/up", body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = contentLength
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return parseProblem(resp.StatusCode, data)
	}
	return nil
}

// WSURL leitet aus BaseURL die WebSocket-URL ab (http->ws, https->wss).
func (c *Client) WSURL() (string, error) {
	u, err := url.Parse(c.BaseURL)
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	default:
		u.Scheme = "ws"
	}
	u.Path = "/ws"
	return u.String(), nil
}
