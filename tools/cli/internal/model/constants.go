package model

import "time"

// Diese Konstanten müssen exakt zu packages/shared/src/constants.ts passen,
// damit die CLI dieselben Mess-Intervalle wie der Browser-Client verwendet.
const (
	PingIntervalMs   = 1000
	PingTimeoutMs    = 3000
	WindowMs         = 5000
	MaxAccuracyM     = 200.0
	ProbeIntervalMs  = 10_000
	WhoamiIntervalMs = 30_000
	// ProbeBody ist der erwartete Antwortkörper von GET /api/net/probe.
	ProbeBody           = "bahn-tracker-probe-ok"
	SpeedtestDurationMs = 8000
	SpeedtestStreams    = 4
	SpeedtestMaxBytes   = 50 * 1024 * 1024
	// SpeedtestContinuousPauseMs ist die Pause zwischen zwei Tests im Dauer-Speedtest.
	SpeedtestContinuousPauseMs = 5000
	BatchMaxSamples            = 500
	BatchFlushMs               = 10_000
)

// WindowDuration als time.Duration, bequem für Timer.
const WindowDuration = time.Duration(WindowMs) * time.Millisecond

// PingInterval als time.Duration.
const PingInterval = time.Duration(PingIntervalMs) * time.Millisecond

// ProbeInterval als time.Duration.
const ProbeInterval = time.Duration(ProbeIntervalMs) * time.Millisecond

// WhoamiInterval als time.Duration.
const WhoamiInterval = time.Duration(WhoamiIntervalMs) * time.Millisecond

// BatchFlushInterval als time.Duration.
const BatchFlushInterval = time.Duration(BatchFlushMs) * time.Millisecond

// SpeedtestContinuousPause als time.Duration.
const SpeedtestContinuousPause = time.Duration(SpeedtestContinuousPauseMs) * time.Millisecond
