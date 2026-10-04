// Package model enthält die Go-Entsprechungen der Zod-Schemas aus
// packages/shared/src/schemas.ts. Feldnamen (JSON-Tags) müssen exakt mit dem
// TypeScript-Vertrag übereinstimmen, damit die CLI dieselben Payloads sendet
// wie der Browser-Client.
package model

// NetClass siehe packages/shared/src/netclass.ts.
type NetClass string

const (
	NetClassDBWlan         NetClass = "db_wlan"
	NetClassMobileTelekom  NetClass = "mobile_telekom"
	NetClassMobileVodafone NetClass = "mobile_vodafone"
	NetClassMobileO2       NetClass = "mobile_o2"
	NetClassMobileOther    NetClass = "mobile_other"
	NetClassVpnHosting     NetClass = "vpn_hosting"
	NetClassPrivate        NetClass = "private"
	NetClassUnknown        NetClass = "unknown"
)

// NetClassLabels siehe NET_CLASS_LABELS in netclass.ts.
var NetClassLabels = map[NetClass]string{
	NetClassDBWlan:         "DB WLAN",
	NetClassMobileTelekom:  "Mobilfunk Telekom",
	NetClassMobileVodafone: "Mobilfunk Vodafone",
	NetClassMobileO2:       "Mobilfunk O2",
	NetClassMobileOther:    "Mobilfunk (sonstige)",
	NetClassVpnHosting:     "VPN / Rechenzentrum",
	NetClassPrivate:        "Lokal / privat",
	NetClassUnknown:        "Unbekannt",
}

// TrainType siehe TRAIN_TYPES in netclass.ts.
type TrainType string

const (
	TrainTypeICE   TrainType = "ice"
	TrainTypeIC    TrainType = "ic"
	TrainTypeRegio TrainType = "regio"
	TrainTypeSBahn TrainType = "sbahn"
	TrainTypeOther TrainType = "other"
)

// TrainTypeLabels siehe TRAIN_TYPE_LABELS in netclass.ts.
var TrainTypeLabels = map[TrainType]string{
	TrainTypeICE:   "ICE",
	TrainTypeIC:    "IC / EC",
	TrainTypeRegio: "RE / RB",
	TrainTypeSBahn: "S-Bahn",
	TrainTypeOther: "Sonstiges",
}

// NetToken entspricht NetToken in schemas.ts.
type NetToken struct {
	Asn       int      `json:"asn"`
	NetClass  NetClass `json:"netClass"`
	IPVersion *int     `json:"ipVersion"`
	Exp       int64    `json:"exp"`
	Sig       string   `json:"sig"`
}

// WhoamiResponse entspricht WhoamiResponse in schemas.ts.
type WhoamiResponse struct {
	NetToken
	AsName string `json:"asName"`
	Label  string `json:"label"`
}

// Me entspricht Me in schemas.ts.
type Me struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	DisplayName *string `json:"displayName"`
	Role        string  `json:"role"`
	CreatedAt   string  `json:"createdAt"`
}

// Trip entspricht Trip in schemas.ts.
type Trip struct {
	ID          string  `json:"id"`
	TrainType   string  `json:"trainType"`
	TrainNumber *string `json:"trainNumber"`
	Platform    string  `json:"platform"`
	StartedAt   string  `json:"startedAt"`
	EndedAt     *string `json:"endedAt"`
	Status      string  `json:"status"`
	SampleCount *int    `json:"sampleCount,omitempty"`
}

// TripStop entspricht TripStop in schemas.ts (Zeiten als ISO-8601/RFC3339).
type TripStop struct {
	Seq                int      `json:"seq"`
	EvaNr              *string  `json:"evaNr"`
	Name               string   `json:"name"`
	Lat                *float64 `json:"lat"`
	Lon                *float64 `json:"lon"`
	ScheduledArrival   *string  `json:"scheduledArrival"`
	ActualArrival      *string  `json:"actualArrival"`
	ScheduledDeparture *string  `json:"scheduledDeparture"`
	ActualDeparture    *string  `json:"actualDeparture"`
	TrackScheduled     *string  `json:"trackScheduled"`
	TrackActual        *string  `json:"trackActual"`
	Passed             *bool    `json:"passed"`
	PositionStatus     *string  `json:"positionStatus"`
}

// TripStopsPut entspricht TripStopsPut in schemas.ts (PUT /api/trips/:id/stops).
type TripStopsPut struct {
	Stops []TripStop `json:"stops"`
}

// TripCreate entspricht TripCreate in schemas.ts.
type TripCreate struct {
	TrainType     TrainType `json:"trainType"`
	TrainNumber   string    `json:"trainNumber,omitempty"`
	Platform      string    `json:"platform"`
	ClockOffsetMs *int64    `json:"clockOffsetMs,omitempty"`
}

// TripEnd entspricht TripEnd in schemas.ts.
type TripEnd struct {
	ClockOffsetMs *int64 `json:"clockOffsetMs,omitempty"`
}

// TripUpdate entspricht TripUpdate in schemas.ts. Wird per PATCH /api/trips/:id
// gesendet, wenn die Zugnummer erst nachträglich aus dem ICE-Portal bekannt wird.
// Die Route existiert serverseitig evtl. noch nicht (Stand dieser Implementierung);
// die CLI behandelt 404 defensiv (siehe apiclient.Client.PatchTrip).
type TripUpdate struct {
	TrainType       *TrainType `json:"trainType,omitempty"`
	TrainNumber     *string    `json:"trainNumber,omitempty"`
	IceTzn          *string    `json:"iceTzn,omitempty"`
	IceSeries       *string    `json:"iceSeries,omitempty"`
	TripDate        *string    `json:"tripDate,omitempty"`
	OriginName      *string    `json:"originName,omitempty"`
	DestinationName *string    `json:"destinationName,omitempty"`
}

// SampleBatch entspricht SampleBatch in schemas.ts.
type SampleBatch struct {
	Samples []Sample `json:"samples"`
}

// SampleBatchResponse entspricht SampleBatchResponse in schemas.ts.
type SampleBatchResponse struct {
	Accepted   int `json:"accepted"`
	Duplicates int `json:"duplicates"`
	Rejected   int `json:"rejected"`
}

// Sample ist die Vereinigung aller Sample-Varianten (ping_window, speedtest, probe).
// Zod validiert per "kind" als Discriminator und entfernt unbekannte Felder aus dem
// jeweils anderen Varianten-Schema stillschweigend (kein .strict()) – daher reicht ein
// einziger flacher Go-Typ mit allen möglichen Feldern, solange "kind" korrekt gesetzt ist.
type Sample struct {
	ID        string    `json:"id"`
	Ts        int64     `json:"ts"`
	Lat       *float64  `json:"lat"`
	Lon       *float64  `json:"lon"`
	AccuracyM *float64  `json:"accuracyM"`
	SpeedMps  *float64  `json:"speedMps"`
	Heading   *float64  `json:"heading"`
	Net       *NetToken `json:"net"`
	ConnType  *string   `json:"connType,omitempty"`
	EffType   *string   `json:"effectiveType,omitempty"`
	IceState  *string   `json:"iceState,omitempty"`
	// Prognose des ICE-Portals (connectivity.nextState/remainingTimeSeconds) und dessen
	// separater Internet-Indikator (z.B. HIGH, OFFLINE).
	IceNextState  *string `json:"iceNextState,omitempty"`
	IceRemainingS *int64  `json:"iceRemainingS,omitempty"`
	IceInternet   *string `json:"iceInternet,omitempty"`
	PosSource     string  `json:"posSource,omitempty"`
	Kind          string  `json:"kind"`

	// ping_window
	N         int      `json:"n,omitempty"`
	Lost      int      `json:"lost,omitempty"`
	RttMin    *float64 `json:"rttMin,omitempty"`
	RttMedian *float64 `json:"rttMedian,omitempty"`
	RttP90    *float64 `json:"rttP90,omitempty"`
	RttMax    *float64 `json:"rttMax,omitempty"`
	JitterMs  *float64 `json:"jitterMs,omitempty"`

	// speedtest
	DownBps     *float64 `json:"downBps,omitempty"`
	UpBps       *float64 `json:"upBps,omitempty"`
	RttIdleMs   *float64 `json:"rttIdleMs,omitempty"`
	RttLoadedMs *float64 `json:"rttLoadedMs,omitempty"`
	DurationMs  *int64   `json:"durationMs,omitempty"`

	// probe
	HttpMs  *float64 `json:"httpMs,omitempty"`
	Ok      *bool    `json:"ok,omitempty"`
	Captive *bool    `json:"captive,omitempty"`
}

const (
	SampleKindPingWindow = "ping_window"
	SampleKindSpeedtest  = "speedtest"
	SampleKindProbe      = "probe"
)

// Problem entspricht RFC 9457 Problem Details (schemas.ts "Problem").
type Problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// ---------- WebSocket-Protokoll ----------

// WsServerMessage ist eine generische Hülle für eingehende Server-Nachrichten;
// je nach "t" wird nur eine Untermenge der Felder befüllt.
type WsServerMessage struct {
	T          string  `json:"t"`
	ServerTime int64   `json:"serverTime,omitempty"`
	Seq        int     `json:"seq,omitempty"`
	Cid        int     `json:"cid,omitempty"`
	T0         int64   `json:"t0,omitempty"`
	T1         int64   `json:"t1,omitempty"`
	T2         int64   `json:"t2,omitempty"`
	RttMs      float64 `json:"rttMs,omitempty"`
}

// WsClientMessage siehe WsClientMessage in schemas.ts.
type WsClientMessage struct {
	T   string `json:"t"`
	Seq int    `json:"seq,omitempty"`
	Cid int    `json:"cid,omitempty"`
	T0  int64  `json:"t0,omitempty"`
}
