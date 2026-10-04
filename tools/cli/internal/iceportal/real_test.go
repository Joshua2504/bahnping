package iceportal

import "testing"

// Echte Antwort aus ICE 1077 (Hamburg → Frankfurt), aufgezeichnet am 2026-10-04.
const realStatus = `{"connection":false,"serviceLevel":"SERVICE_ERROR","gpsStatus":"VALID","internet":"OFFLINE","latitude":53.4520246667,"longitude":9.9949843333,"tileY":383,"tileX":28,"series":"412","serverTime":1791131517610,"speed":112.8,"trainType":"ICE","tzn":"ICE9012","vzn":1077,"launchTime":"2026-10-04T18:02:00","wagonClass":"SECOND","ecmVersion":"2026-10-02T21:39:51","connectivity":{"currentState":"NO_INTERNET"}}`

const realTrip = `{"trip":{"tripDate":"2026-10-04","trainType":"ICE","vzn":"1077","stopInfo":{"scheduledNext":"8000152","actualNext":"8000152","finalStationName":"Frankfurt(M) Flughafen Regionalbf"},"stops":[{"station":{"evaNr":"8002549","name":"Hamburg Hbf"},"timetable":{"scheduledArrivalTime":1791130500000,"actualArrivalTime":1791130539000,"arrivalDelay":""},"info":{"passed":true,"positionStatus":"departed"}},{"station":{"evaNr":"8000152","name":"Hannover Hbf"},"timetable":{"scheduledArrivalTime":1791135480000,"actualArrivalTime":1791135480000,"arrivalDelay":""},"info":{"passed":false,"positionStatus":"future"}}],"journeyDisplayValue":"ICE 1077"}}`

func TestRealStatus(t *testing.T) {
	st, err := ParseStatus([]byte(realStatus))
	if err != nil {
		t.Fatal(err)
	}
	if st.Latitude == nil || *st.Latitude < 53.45 || *st.Latitude > 53.46 {
		t.Fatalf("Breitengrad falsch: %v", st.Latitude)
	}
	if st.SpeedKmh == nil || *st.SpeedKmh != 112.8 {
		t.Fatalf("Geschwindigkeit falsch: %v", st.SpeedKmh)
	}
	if !st.GpsValid() {
		t.Fatal("GPS sollte gültig sein")
	}
	if s := st.IceState(); s == nil || *s != "NO_INTERNET" {
		t.Fatalf("ICE-Status falsch: %v", s)
	}
}

func TestRealTrip(t *testing.T) {
	ti, err := ParseTripInfo([]byte(realTrip))
	if err != nil {
		t.Fatal(err)
	}
	if ti.Vzn == nil || *ti.Vzn != "1077" {
		t.Fatalf("Zugnummer falsch: %v", ti.Vzn)
	}
	next := ti.NextStop()
	if next == nil || next.StationName == nil || *next.StationName != "Hannover Hbf" {
		t.Fatalf("nächster Halt falsch: %+v", next)
	}
}

func TestParseRealExtraFields(t *testing.T) {
	st, err := ParseStatus([]byte(realStatus))
	if err != nil {
		t.Fatal(err)
	}
	if st.Series == nil || *st.Series != "412" {
		t.Fatalf("Series falsch: %v", st.Series)
	}
	if st.Vzn == nil || *st.Vzn != "1077" {
		t.Fatalf("Vzn (als Zahl) falsch: %v", st.Vzn)
	}
	if st.Internet == nil || *st.Internet != "OFFLINE" {
		t.Fatalf("Internet falsch: %v", st.Internet)
	}
	if st.IceNextState() != nil || st.IceRemainingS() != nil {
		t.Fatalf("Prognose sollte fehlen: %v %v", st.IceNextState(), st.IceRemainingS())
	}
	ti, err := ParseTripInfo([]byte(realTrip))
	if err != nil {
		t.Fatal(err)
	}
	if ti.TripDate == nil || *ti.TripDate != "2026-10-04" {
		t.Fatalf("TripDate falsch: %v", ti.TripDate)
	}
	if len(ti.Stops) != 2 || ti.Stops[0].EvaNr == nil || *ti.Stops[0].EvaNr != "8002549" {
		t.Fatalf("EvaNr falsch: %+v", ti.Stops)
	}
	if ti.Stops[1].PositionStatus == nil || *ti.Stops[1].PositionStatus != "future" {
		t.Fatalf("PositionStatus falsch: %+v", ti.Stops[1])
	}
}
