// Package iceportal liest die inoffizielle ICE-Portal-API (nur im WIFIonICE erreichbar)
// aus: GET /api1/rs/status (Position, Geschwindigkeit, Konnektivität) und
// GET /api1/rs/tripInfo/trip (Zugnummer, Fahrplan). Alle Felder werden defensiv geparst
// (alles optional, Zahlen können als String kommen), siehe PLANUNG.md 6.6.
package iceportal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	DefaultBaseURL = "https://iceportal.de"
	statusPath     = "/api1/rs/status"
	tripPath       = "/api1/rs/tripInfo/trip"
	requestTimeout = 5 * time.Second
)

// ---------- Defensive JSON-Helfer ----------

// isJSONNull erkennt das Literal "null" (ggf. mit Leerraum) – json.Unmarshal lässt beim
// Dekodieren von null in einen Nicht-Zeiger-Wert (z.B. float64) diesen unverändert (0),
// statt einen Fehler zu liefern; ohne diese Prüfung würde ein JSON-null fälschlich zu 0.
func isJSONNull(raw json.RawMessage) bool {
	return strings.TrimSpace(string(raw)) == "null"
}

func asFloat(raw json.RawMessage) *float64 {
	if len(raw) == 0 || isJSONNull(raw) {
		return nil
	}
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		return &f
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			return &v
		}
	}
	return nil
}

func asInt64(raw json.RawMessage) *int64 {
	f := asFloat(raw)
	if f == nil {
		return nil
	}
	v := int64(*f)
	return &v
}

func asString(raw json.RawMessage) *string {
	if len(raw) == 0 || isJSONNull(raw) {
		return nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		if s == "" {
			return nil
		}
		return &s
	}
	// Manche Felder könnten als Zahl kommen, obwohl ein String erwartet wird (z.B. vzn).
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		s := strconv.FormatFloat(f, 'f', -1, 64)
		return &s
	}
	return nil
}

func asBool(raw json.RawMessage) *bool {
	if len(raw) == 0 || isJSONNull(raw) {
		return nil
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err == nil {
		return &b
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "true", "1", "yes":
			v := true
			return &v
		case "false", "0", "no":
			v := false
			return &v
		}
	}
	return nil
}

// ---------- Typen ----------

// Connectivity entspricht connectivity im Status-Response.
type Connectivity struct {
	CurrentState         *string
	NextState            *string
	RemainingTimeSeconds *int64
}

// Status entspricht GET /api1/rs/status.
type Status struct {
	Latitude     *float64
	Longitude    *float64
	SpeedKmh     *float64
	ServerTimeMs *int64
	TrainType    *string
	// Triebzugnummer (physische Einheit, z.B. "ICE9012") – nicht die Zugnummer (vzn).
	Tzn *string
	// Zugnummer laut Status (vzn, z.B. "1077"); tripInfo liefert sie ebenfalls.
	Vzn *string
	// Baureihe, z.B. "412" (ICE 4).
	Series       *string
	WagonClass   *string
	ServiceLevel *string
	GpsStatus    *string
	// Internet-Indikator des Portals: in der Praxis ein String (z.B. "HIGH", "OFFLINE"),
	// in älteren Varianten ein Bool – beides wird auf einen String abgebildet ("true"/"false").
	Internet     *string
	Connectivity *Connectivity
	FetchedAt    time.Time
	Raw          string
}

// SpeedMps liefert die Geschwindigkeit in m/s (speedMps = speed/3.6), nil falls unbekannt.
func (s *Status) SpeedMps() *float64 {
	if s == nil || s.SpeedKmh == nil {
		return nil
	}
	v := *s.SpeedKmh / 3.6
	return &v
}

// GpsValid prüft gpsStatus == "VALID" (case-insensitive, defensiv).
func (s *Status) GpsValid() bool {
	return s != nil && s.GpsStatus != nil && strings.EqualFold(*s.GpsStatus, "VALID")
}

// IceState liefert connectivity.currentState, oder nil.
func (s *Status) IceState() *string {
	if s == nil || s.Connectivity == nil {
		return nil
	}
	return s.Connectivity.CurrentState
}

// IceNextState liefert connectivity.nextState (Prognose), oder nil.
func (s *Status) IceNextState() *string {
	if s == nil || s.Connectivity == nil {
		return nil
	}
	return s.Connectivity.NextState
}

// IceRemainingS liefert connectivity.remainingTimeSeconds (Sekunden bis zum nächsten Status), oder nil.
func (s *Status) IceRemainingS() *int64 {
	if s == nil || s.Connectivity == nil {
		return nil
	}
	return s.Connectivity.RemainingTimeSeconds
}

// asInternet bildet das Feld internet (String oder Bool) auf einen String ab.
func asInternet(raw json.RawMessage) *string {
	if s := asString(raw); s != nil {
		return s
	}
	if b := asBool(raw); b != nil {
		v := strconv.FormatBool(*b)
		return &v
	}
	return nil
}

type rawConnectivity struct {
	CurrentState         json.RawMessage `json:"currentState"`
	NextState            json.RawMessage `json:"nextState"`
	RemainingTimeSeconds json.RawMessage `json:"remainingTimeSeconds"`
}

type rawStatus struct {
	Latitude     json.RawMessage  `json:"latitude"`
	Longitude    json.RawMessage  `json:"longitude"`
	Speed        json.RawMessage  `json:"speed"`
	ServerTime   json.RawMessage  `json:"serverTime"`
	TrainType    json.RawMessage  `json:"trainType"`
	Tzn          json.RawMessage  `json:"tzn"`
	Vzn          json.RawMessage  `json:"vzn"`
	Series       json.RawMessage  `json:"series"`
	WagonClass   json.RawMessage  `json:"wagonClass"`
	ServiceLevel json.RawMessage  `json:"serviceLevel"`
	GpsStatus    json.RawMessage  `json:"gpsStatus"`
	Internet     json.RawMessage  `json:"internet"`
	Connectivity *rawConnectivity `json:"connectivity"`
}

// ParseStatus parst den Status-Response defensiv. Unbekannte/fehlende Felder werden nil, kein Fehler.
func ParseStatus(data []byte) (*Status, error) {
	var raw rawStatus
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("Status-JSON ungültig: %w", err)
	}
	st := &Status{
		Latitude:     asFloat(raw.Latitude),
		Longitude:    asFloat(raw.Longitude),
		SpeedKmh:     asFloat(raw.Speed),
		ServerTimeMs: asInt64(raw.ServerTime),
		TrainType:    asString(raw.TrainType),
		Tzn:          asString(raw.Tzn),
		Vzn:          asString(raw.Vzn),
		Series:       asString(raw.Series),
		WagonClass:   asString(raw.WagonClass),
		ServiceLevel: asString(raw.ServiceLevel),
		GpsStatus:    asString(raw.GpsStatus),
		Internet:     asInternet(raw.Internet),
		FetchedAt:    time.Now(),
		Raw:          string(data),
	}
	if raw.Connectivity != nil {
		st.Connectivity = &Connectivity{
			CurrentState:         asString(raw.Connectivity.CurrentState),
			NextState:            asString(raw.Connectivity.NextState),
			RemainingTimeSeconds: asInt64(raw.Connectivity.RemainingTimeSeconds),
		}
	}
	return st, nil
}

// Stop entspricht einem Eintrag in trip.stops[].
type Stop struct {
	EvaNr                    *string
	StationName              *string
	Latitude                 *float64
	Longitude                *float64
	ScheduledArrivalTimeMs   *int64
	ActualArrivalTimeMs      *int64
	ScheduledDepartureTimeMs *int64
	ActualDepartureTimeMs    *int64
	TrackScheduled           *string
	TrackActual              *string
	Passed                   *bool
	PositionStatus           *string
}

// TripInfo entspricht GET /api1/rs/tripInfo/trip.
type TripInfo struct {
	TripDate         *string
	TrainType        *string
	Vzn              *string
	FinalStationName *string
	Stops            []Stop
	Raw              string
}

type rawGeo struct {
	Latitude  json.RawMessage `json:"latitude"`
	Longitude json.RawMessage `json:"longitude"`
}
type rawStation struct {
	EvaNr          json.RawMessage `json:"evaNr"`
	Name           json.RawMessage `json:"name"`
	Geocoordinates *rawGeo         `json:"geocoordinates"`
}
type rawTimetable struct {
	ScheduledArrivalTime   json.RawMessage `json:"scheduledArrivalTime"`
	ActualArrivalTime      json.RawMessage `json:"actualArrivalTime"`
	ScheduledDepartureTime json.RawMessage `json:"scheduledDepartureTime"`
	ActualDepartureTime    json.RawMessage `json:"actualDepartureTime"`
}
type rawTrack struct {
	Scheduled json.RawMessage `json:"scheduled"`
	Actual    json.RawMessage `json:"actual"`
}
type rawStopInfoFlags struct {
	Passed         json.RawMessage `json:"passed"`
	PositionStatus json.RawMessage `json:"positionStatus"`
}
type rawStop struct {
	Station   *rawStation       `json:"station"`
	Timetable *rawTimetable     `json:"timetable"`
	Track     *rawTrack         `json:"track"`
	Info      *rawStopInfoFlags `json:"info"`
}
type rawStopInfo struct {
	FinalStationName json.RawMessage `json:"finalStationName"`
}
type rawTrip struct {
	TripDate  json.RawMessage `json:"tripDate"`
	TrainType json.RawMessage `json:"trainType"`
	Vzn       json.RawMessage `json:"vzn"`
	StopInfo  *rawStopInfo    `json:"stopInfo"`
	Stops     []rawStop       `json:"stops"`
}
type rawTripInfo struct {
	Trip *rawTrip `json:"trip"`
}

// ParseTripInfo parst den TripInfo-Response defensiv.
func ParseTripInfo(data []byte) (*TripInfo, error) {
	var raw rawTripInfo
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("TripInfo-JSON ungültig: %w", err)
	}
	ti := &TripInfo{Raw: string(data)}
	if raw.Trip == nil {
		return ti, nil
	}
	ti.TripDate = asString(raw.Trip.TripDate)
	ti.TrainType = asString(raw.Trip.TrainType)
	ti.Vzn = asString(raw.Trip.Vzn)
	if raw.Trip.StopInfo != nil {
		ti.FinalStationName = asString(raw.Trip.StopInfo.FinalStationName)
	}
	for _, s := range raw.Trip.Stops {
		stop := Stop{}
		if s.Station != nil {
			stop.EvaNr = asString(s.Station.EvaNr)
			stop.StationName = asString(s.Station.Name)
			if s.Station.Geocoordinates != nil {
				stop.Latitude = asFloat(s.Station.Geocoordinates.Latitude)
				stop.Longitude = asFloat(s.Station.Geocoordinates.Longitude)
			}
		}
		if s.Timetable != nil {
			stop.ScheduledArrivalTimeMs = asInt64(s.Timetable.ScheduledArrivalTime)
			stop.ActualArrivalTimeMs = asInt64(s.Timetable.ActualArrivalTime)
			stop.ScheduledDepartureTimeMs = asInt64(s.Timetable.ScheduledDepartureTime)
			stop.ActualDepartureTimeMs = asInt64(s.Timetable.ActualDepartureTime)
		}
		if s.Track != nil {
			stop.TrackScheduled = asString(s.Track.Scheduled)
			stop.TrackActual = asString(s.Track.Actual)
		}
		if s.Info != nil {
			stop.Passed = asBool(s.Info.Passed)
			stop.PositionStatus = asString(s.Info.PositionStatus)
		}
		ti.Stops = append(ti.Stops, stop)
	}
	return ti, nil
}

// NextStop liefert den ersten noch nicht passierten Halt, oder nil.
func (t *TripInfo) NextStop() *Stop {
	if t == nil {
		return nil
	}
	for i := range t.Stops {
		s := &t.Stops[i]
		if s.Passed == nil || !*s.Passed {
			return s
		}
	}
	return nil
}

// ---------- HTTP-Client ----------

// Client ruft die ICE-Portal-API ab.
type Client struct {
	BaseURL string
	HTTP    *http.Client
	// useCurl wird gesetzt, sobald macOS die direkte Verbindung blockiert ("no route to host").
	useCurl atomic.Bool
}

// New erzeugt einen Client mit dem gegebenen Basis-URL (Standard https://iceportal.de,
// per --iceportal-url für Tests mit einem Mock überschreibbar).
func New(baseURL string) *Client {
	if baseURL == "" {
		baseURL = DefaultBaseURL
	}
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP:    &http.Client{Timeout: requestTimeout},
	}
}

func (c *Client) get(ctx context.Context, path string) ([]byte, error) {
	if c.useCurl.Load() {
		return curlGet(ctx, c.BaseURL+path)
	}
	data, err := c.getDirect(ctx, path)
	if err != nil && runtime.GOOS == "darwin" && strings.Contains(err.Error(), "no route to host") {
		// macOS 15+ (Local Network Privacy) blockiert private Adressen für unsignierte Programme,
		// das Apple-signierte /usr/bin/curl darf sie aber erreichen. Ab jetzt immer curl verwenden.
		if cdata, cerr := curlGet(ctx, c.BaseURL+path); cerr == nil {
			c.useCurl.Store(true)
			return cdata, nil
		}
	}
	return data, err
}

// UsingCurl meldet, ob der Client auf den curl-Fallback umgeschaltet hat (für die Anzeige).
func (c *Client) UsingCurl() bool { return c.useCurl.Load() }

func (c *Client) getDirect(ctx context.Context, path string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) bahnping")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return data, nil
}

// ShortError macht aus Netzwerkfehlern eine kurze, verständliche Meldung für die Anzeige.
func ShortError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no such host"):
		return "DNS: iceportal.de nicht auflösbar (kein ICE-WLAN?)"
	case strings.Contains(msg, "deadline exceeded"), strings.Contains(msg, "Timeout"):
		return "Zeitüberschreitung"
	case strings.Contains(msg, "no route to host") && runtime.GOOS == "darwin":
		// macOS 15+: ohne Berechtigung "Lokales Netzwerk" sind private Adressen nicht erreichbar.
		return "macOS blockiert: Terminal unter Datenschutz → Lokales Netzwerk erlauben"
	case strings.Contains(msg, "no route to host"):
		return "Keine Route zum Portal"
	case strings.Contains(msg, "connection refused"):
		return "Verbindung abgelehnt"
	case strings.Contains(msg, "certificate"), strings.Contains(msg, "x509"):
		return "TLS-Zertifikat ungültig"
	}
	if len(msg) > 80 {
		msg = msg[:80] + "…"
	}
	return msg
}

// FetchStatus ruft GET /api1/rs/status ab.
func (c *Client) FetchStatus(ctx context.Context) (*Status, error) {
	data, err := c.get(ctx, statusPath)
	if err != nil {
		return nil, err
	}
	return ParseStatus(data)
}

// FetchTripInfo ruft GET /api1/rs/tripInfo/trip ab.
func (c *Client) FetchTripInfo(ctx context.Context) (*TripInfo, error) {
	data, err := c.get(ctx, tripPath)
	if err != nil {
		return nil, err
	}
	return ParseTripInfo(data)
}
