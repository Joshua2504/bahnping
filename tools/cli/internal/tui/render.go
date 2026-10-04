package tui

import (
	"fmt"
	"io"
	"strings"
	"time"
)

var sparkBlocks = []rune("▁▂▃▄▅▆▇█")

// Sparkline erzeugt eine Unicode-Block-Sparkline aus den gegebenen Werten.
func Sparkline(values []float64) string {
	if len(values) == 0 {
		return ""
	}
	min, max := values[0], values[0]
	for _, v := range values {
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	var b strings.Builder
	rng := max - min
	for _, v := range values {
		idx := 0
		if rng > 0 {
			idx = int((v - min) / rng * float64(len(sparkBlocks)-1))
		}
		if idx < 0 {
			idx = 0
		}
		if idx >= len(sparkBlocks) {
			idx = len(sparkBlocks) - 1
		}
		b.WriteRune(sparkBlocks[idx])
	}
	return b.String()
}

// clearHome bewegt den Cursor an den Anfang des Bildschirms und löscht ihn.
// Einmaliges "\x1b[2J\x1b[H" beim ersten Zeichnen, danach nur "\x1b[H" +
// zeilenweises Löschen, um Flackern/Scroll-Spam zu vermeiden.
const (
	ansiClearScreen = "\x1b[2J\x1b[H"
	ansiHome        = "\x1b[H"
	ansiClearLine   = "\x1b[K"
)

// Render zeichnet die Live-Ansicht. first=true löscht einmalig den ganzen Bildschirm.
func Render(w io.Writer, s Snapshot, first bool) {
	var b strings.Builder
	if first {
		b.WriteString(ansiClearScreen)
	} else {
		b.WriteString(ansiHome)
	}

	line := func(format string, args ...any) {
		fmt.Fprintf(&b, format, args...)
		b.WriteString(ansiClearLine)
		// Im Raw-Mode gibt es keine automatische Wagenrücklauf-Umsetzung, daher \r\n.
		b.WriteString("\r\n")
	}

	dur := time.Duration(0)
	if !s.StartedAt.IsZero() {
		dur = time.Since(s.StartedAt).Round(time.Second)
	}

	line("bahnping – Fahrt %s  %s  Dauer %s", shortID(s.TripID), s.TrainLabel, dur)
	line("")

	wsStatus := "getrennt"
	if s.ConnectedWS {
		wsStatus = "verbunden"
	}
	line("RTT      %-8s  Jitter %-8s  WS %s", fmtFloatPtr(s.LastRttMs, "ms", 0), fmtFloatPtr(s.JitterMs, "ms", 1), wsStatus)
	line("Verlauf  %s", Sparkline(s.RttHistory))
	line("Verlust (60s) %-8s  Verfügbarkeit %-8s", fmtPercent(s.Loss60sPct), fmtPercent(s.AvailPct))
	line("")

	net := s.NetLabel
	if net == "" {
		net = "unbekannt"
	}
	ipv := "–"
	if s.IPVersion != nil {
		ipv = fmt.Sprintf("IPv%d", *s.IPVersion)
	}
	line("Netz     %s  ASN %d (%s)  %s", net, s.NetAsn, orDash(s.NetAsName), ipv)
	if s.Captive {
		line("         ACHTUNG: Captive Portal erkannt – bitte im Browser anmelden")
	}
	line("")

	if s.IcePortalAvailable {
		speed := fmtFloatPtr(s.IceSpeedKmh, " km/h", 0)
		state := iceStateLabel(s.IceState)
		next := orDash(s.NextStopName)
		delay := fmtIntPtr(s.NextStopDelayMin, " min")
		line("ICE-Portal verfügbar  Geschwindigkeit %s  Netzprognose %s", speed, state)
		line("Nächster Halt %s  Verspätung %s", next, delay)
	} else {
		if s.IcePortalError != "" {
			line("ICE-Portal nicht verfügbar: %s", s.IcePortalError)
		} else {
			line("ICE-Portal nicht verfügbar")
		}
	}
	posSrc := s.PosSource
	if posSrc == "" {
		posSrc = "none"
	}
	if s.PosLat != nil && s.PosLon != nil {
		line("Position %.5f, %.5f (Quelle: %s)", *s.PosLat, *s.PosLon, posSrc)
	} else {
		line("Position unbekannt (Quelle: %s)", posSrc)
	}
	line("")

	line("Puffer   %d ausstehend  Upload %s", s.OutboxPending, s.UploadStatus)
	line("Speedtest  %s", s.LastSpeedtest)
	line("")
	line("[s] Speedtest   [q] Beenden")

	fmt.Fprint(w, b.String())
}

// RenderPlainLine erzeugt eine Log-Zeile (für --plain) statt der ANSI-Live-Ansicht.
func RenderPlainLine(s Snapshot) string {
	ts := time.Now().Format("15:04:05")
	return fmt.Sprintf(
		"%s rtt=%s jitter=%s loss60s=%s avail=%s net=%s asn=%d ice=%s pos=%s captive=%t buf=%d",
		ts,
		fmtFloatPtr(s.LastRttMs, "ms", 0),
		fmtFloatPtr(s.JitterMs, "ms", 1),
		fmtPercent(s.Loss60sPct),
		fmtPercent(s.AvailPct),
		orDash(s.NetLabel),
		s.NetAsn,
		boolToAvailability(s.IcePortalAvailable),
		posDescription(s),
		s.Captive,
		s.OutboxPending,
	)
}

func posDescription(s Snapshot) string {
	if s.PosLat == nil || s.PosLon == nil {
		return "none"
	}
	return fmt.Sprintf("%.4f,%.4f(%s)", *s.PosLat, *s.PosLon, s.PosSource)
}

func boolToAvailability(v bool) string {
	if v {
		return "ok"
	}
	return "n/a"
}

func fmtPercent(v *float64) string {
	if v == nil {
		return "–"
	}
	return fmt.Sprintf("%.0f%%", *v)
}

// iceStateLabel übersetzt connectivity.currentState des Bordportals. Das ist keine
// Messung, sondern die Abdeckungsprognose der DB für den aktuellen Streckenabschnitt.
func iceStateLabel(s string) string {
	switch strings.ToUpper(s) {
	case "":
		return "–"
	case "HIGH":
		return "gut"
	case "WEAK":
		return "schwach"
	case "UNSTABLE":
		return "instabil"
	case "NO_INTERNET":
		return "Funkloch"
	default:
		return s
	}
}

func orDash(s string) string {
	if s == "" {
		return "–"
	}
	return s
}

func shortID(id string) string {
	if len(id) <= 8 {
		return id
	}
	return id[:8]
}
