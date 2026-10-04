package iceportal

import (
	"encoding/json"
	"testing"
)

// Aufgezeichnetes Beispiel (vereinfacht, nach öffentlich bekannten iceportal.de-Formaten),
// Zahlen als echte JSON-Numbers.
const statusJSONNumbers = `{
  "latitude": 50.1234,
  "longitude": 8.6789,
  "speed": 231.5,
  "serverTime": 1719900000000,
  "trainType": "ICE",
  "tzn": "ICE 599",
  "gpsStatus": "VALID",
  "internet": true,
  "connectivity": {
    "currentState": "HIGH",
    "nextState": "MIDDLE",
    "remainingTimeSeconds": 120
  }
}`

// Variante mit Zahlen als Strings (in freier Wildbahn beobachtet) – muss ebenso funktionieren.
const statusJSONStrings = `{
  "latitude": "50.1234",
  "longitude": "8.6789",
  "speed": "231.5",
  "serverTime": "1719900000000",
  "trainType": "ICE",
  "tzn": "ICE 599",
  "gpsStatus": "VALID",
  "internet": "true",
  "connectivity": {
    "currentState": "HIGH",
    "nextState": "MIDDLE",
    "remainingTimeSeconds": "120"
  }
}`

const statusJSONMissingFields = `{ "trainType": "ICE" }`

func TestParseStatusNumbers(t *testing.T) {
	st, err := ParseStatus([]byte(statusJSONNumbers))
	if err != nil {
		t.Fatal(err)
	}
	if st.Latitude == nil || *st.Latitude != 50.1234 {
		t.Fatalf("Latitude falsch: %v", st.Latitude)
	}
	if st.SpeedKmh == nil || *st.SpeedKmh != 231.5 {
		t.Fatalf("Speed falsch: %v", st.SpeedKmh)
	}
	if got := st.SpeedMps(); got == nil || *got < 64.3 || *got > 64.4 {
		t.Fatalf("SpeedMps falsch: %v", got)
	}
	if !st.GpsValid() {
		t.Fatal("GpsValid sollte true sein")
	}
	if st.Connectivity == nil || st.Connectivity.CurrentState == nil || *st.Connectivity.CurrentState != "HIGH" {
		t.Fatalf("Connectivity falsch: %+v", st.Connectivity)
	}
	if st.Connectivity.RemainingTimeSeconds == nil || *st.Connectivity.RemainingTimeSeconds != 120 {
		t.Fatalf("RemainingTimeSeconds falsch: %v", st.Connectivity.RemainingTimeSeconds)
	}
}

func TestParseStatusStringNumbers(t *testing.T) {
	st, err := ParseStatus([]byte(statusJSONStrings))
	if err != nil {
		t.Fatal(err)
	}
	if st.Latitude == nil || *st.Latitude != 50.1234 {
		t.Fatalf("Latitude (als String) falsch: %v", st.Latitude)
	}
	if st.SpeedKmh == nil || *st.SpeedKmh != 231.5 {
		t.Fatalf("Speed (als String) falsch: %v", st.SpeedKmh)
	}
	if st.Internet == nil || *st.Internet != "true" {
		t.Fatalf("Internet (als String) falsch: %v", st.Internet)
	}
	if st.Connectivity.RemainingTimeSeconds == nil || *st.Connectivity.RemainingTimeSeconds != 120 {
		t.Fatalf("RemainingTimeSeconds (als String) falsch: %v", st.Connectivity.RemainingTimeSeconds)
	}
}

func TestParseStatusMissingFieldsDefensive(t *testing.T) {
	st, err := ParseStatus([]byte(statusJSONMissingFields))
	if err != nil {
		t.Fatal(err)
	}
	if st.Latitude != nil || st.Longitude != nil || st.SpeedKmh != nil {
		t.Fatalf("erwarte nil für fehlende Felder: %+v", st)
	}
	if st.TrainType == nil || *st.TrainType != "ICE" {
		t.Fatalf("trainType falsch: %v", st.TrainType)
	}
	if st.GpsValid() {
		t.Fatal("GpsValid sollte false sein ohne gpsStatus")
	}
}

// Regression: json.Unmarshal lässt beim Dekodieren von JSON-null in einen
// Nicht-Zeiger-Wert (z.B. float64) diesen unverändert (0) statt einen Fehler zu liefern.
// Ohne explizite null-Prüfung (isJSONNull) würde das fälschlich zu 0 statt nil führen –
// z.B. bei actualArrivalTime, bevor ein Zug einen Halt tatsächlich erreicht hat.
func TestAsFloatAsIntAsStringAsBoolTreatJSONNullAsMissing(t *testing.T) {
	null := json.RawMessage(`null`)
	if got := asFloat(null); got != nil {
		t.Fatalf("asFloat(null) sollte nil sein, war %v", *got)
	}
	if got := asInt64(null); got != nil {
		t.Fatalf("asInt64(null) sollte nil sein, war %v", *got)
	}
	if got := asString(null); got != nil {
		t.Fatalf("asString(null) sollte nil sein, war %v", *got)
	}
	if got := asBool(null); got != nil {
		t.Fatalf("asBool(null) sollte nil sein, war %v", *got)
	}
}

func TestParseStatusGarbage(t *testing.T) {
	if _, err := ParseStatus([]byte(`not json`)); err == nil {
		t.Fatal("erwarte Fehler bei kaputtem JSON")
	}
}

const tripInfoJSON = `{
  "trip": {
    "trainType": "ICE",
    "vzn": "599",
    "stopInfo": { "finalStationName": "Hamburg Hbf" },
    "stops": [
      {
        "station": { "name": "Frankfurt(Main)Hbf" },
        "timetable": { "scheduledArrivalTime": "1719899000000", "actualArrivalTime": "1719899060000" },
        "info": { "passed": true }
      },
      {
        "station": { "name": "Fulda" },
        "timetable": { "scheduledArrivalTime": 1719900000000, "actualArrivalTime": null },
        "info": { "passed": false }
      }
    ]
  }
}`

func TestParseTripInfo(t *testing.T) {
	ti, err := ParseTripInfo([]byte(tripInfoJSON))
	if err != nil {
		t.Fatal(err)
	}
	if ti.Vzn == nil || *ti.Vzn != "599" {
		t.Fatalf("vzn falsch: %v", ti.Vzn)
	}
	if ti.FinalStationName == nil || *ti.FinalStationName != "Hamburg Hbf" {
		t.Fatalf("finalStationName falsch: %v", ti.FinalStationName)
	}
	if len(ti.Stops) != 2 {
		t.Fatalf("erwarte 2 Halte, got %d", len(ti.Stops))
	}
	if ti.Stops[0].ScheduledArrivalTimeMs == nil || *ti.Stops[0].ScheduledArrivalTimeMs != 1719899000000 {
		t.Fatalf("scheduledArrivalTime (String) falsch: %v", ti.Stops[0].ScheduledArrivalTimeMs)
	}
	next := ti.NextStop()
	if next == nil || next.StationName == nil || *next.StationName != "Fulda" {
		t.Fatalf("NextStop falsch: %+v", next)
	}
}

func TestParseTripInfoEmpty(t *testing.T) {
	ti, err := ParseTripInfo([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if ti.Vzn != nil || len(ti.Stops) != 0 {
		t.Fatalf("erwarte leeres TripInfo: %+v", ti)
	}
	if ti.NextStop() != nil {
		t.Fatal("NextStop sollte nil sein ohne Stops")
	}
}
