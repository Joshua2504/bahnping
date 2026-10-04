package iceportal

import "testing"

func TestParseCurlOutput(t *testing.T) {
	body, err := parseCurlOutput([]byte(`{"speed":99.6}` + curlMarker + "200"))
	if err != nil || string(body) != `{"speed":99.6}` {
		t.Fatalf("got %q, %v", body, err)
	}
	if _, err := parseCurlOutput([]byte("nope" + curlMarker + "404")); err == nil {
		t.Fatal("404 muss Fehler sein")
	}
	if _, err := parseCurlOutput([]byte("kein marker")); err == nil {
		t.Fatal("fehlender Marker muss Fehler sein")
	}
}
