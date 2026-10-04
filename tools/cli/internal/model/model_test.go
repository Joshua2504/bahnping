package model

import (
	"encoding/json"
	"testing"
)

// Zod verlangt die varianten-spezifischen Felder als Pflichtfelder (nullable, nicht optional).
func TestSampleJSONKeepsRequiredFields(t *testing.T) {
	cases := map[string][]string{
		SampleKindPingWindow: {"n", "lost", "rttMin", "rttMedian", "rttP90", "rttMax", "jitterMs"},
		SampleKindSpeedtest:  {"downBps", "upBps", "rttIdleMs", "rttLoadedMs", "durationMs"},
		SampleKindProbe:      {"httpMs", "ok", "captive"},
	}
	for kind, keys := range cases {
		data, err := json.Marshal(Sample{ID: "x", Kind: kind})
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		for _, k := range keys {
			if _, ok := m[k]; !ok {
				t.Errorf("%s: Feld %q fehlt im JSON (%s)", kind, k, data)
			}
		}
	}
}
