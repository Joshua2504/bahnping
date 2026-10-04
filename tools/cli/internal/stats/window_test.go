package stats

import "testing"

func f(v float64) *float64 { return &v }

func approxEq(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 1e-9
}

func TestMedianEmpty(t *testing.T) {
	if Median(nil) != nil {
		t.Fatal("erwarte nil bei leerer Liste")
	}
}

func TestMedianOddEven(t *testing.T) {
	if got := Median([]float64{30, 10, 20}); got == nil || !approxEq(*got, 20) {
		t.Fatalf("Median ungerade falsch: %v", got)
	}
	if got := Median([]float64{10, 30, 20, 40}); got == nil || !approxEq(*got, 25) {
		t.Fatalf("Median gerade falsch: %v", got)
	}
}

func TestPercentile90(t *testing.T) {
	// 5 Werte sortiert: 10,20,30,40,50 -> idx = ceil(0.9*5)-1 = 4 -> 50
	got := Percentile([]float64{50, 10, 40, 20, 30}, 90)
	if got == nil || !approxEq(*got, 50) {
		t.Fatalf("P90 falsch: %v", got)
	}
}

func TestMeanAbsDiff(t *testing.T) {
	if MeanAbsDiff([]float64{10}) != nil {
		t.Fatal("erwarte nil bei < 2 Werten")
	}
	// |20-10| + |15-20| = 10+5 = 15 / 2 = 7.5
	got := MeanAbsDiff([]float64{10, 20, 15})
	if got == nil || !approxEq(*got, 7.5) {
		t.Fatalf("Jitter falsch: %v", got)
	}
}

func TestComputeFullWindow(t *testing.T) {
	rtts := []float64{10, 20, 30, 40, 50}
	res := Compute(rtts)
	if res.N != 5 || res.Lost != 0 {
		t.Fatalf("n/lost falsch: n=%d lost=%d", res.N, res.Lost)
	}
	if res.RttMin == nil || *res.RttMin != 10 {
		t.Fatalf("Min falsch: %v", res.RttMin)
	}
	if res.RttMax == nil || *res.RttMax != 50 {
		t.Fatalf("Max falsch: %v", res.RttMax)
	}
	if res.RttMedian == nil || *res.RttMedian != 30 {
		t.Fatalf("Median falsch: %v", res.RttMedian)
	}
}

func TestComputeCountsOnlyReceived(t *testing.T) {
	// Compute kennt keine Sequenznummern: n = empfangen, kein Verlust (Verlust zählt Aggregator.Flush).
	res := Compute([]float64{10, 20})
	if res.N != 2 || res.Lost != 0 {
		t.Fatalf("n/lost falsch: n=%d lost=%d", res.N, res.Lost)
	}
}

func TestComputeEmptyWindowAllLost(t *testing.T) {
	res := Compute(nil)
	if res.N != 5 || res.Lost != 5 {
		t.Fatalf("lost falsch bei leerem Fenster: n=%d lost=%d", res.N, res.Lost)
	}
	if res.RttMin != nil || res.RttMedian != nil || res.RttP90 != nil || res.RttMax != nil || res.JitterMs != nil {
		t.Fatal("erwarte überall nil bei leerem Fenster")
	}
}

func TestAggregatorFlushResetsWindow(t *testing.T) {
	var agg Aggregator
	agg.AddRtt(1, 10)
	agg.AddRtt(2, 20)
	first := agg.Flush()
	// Erstes Fenster ohne Vorgeschichte: Sequenzen 1,2 lückenlos → n=2, kein Verlust.
	if first.N != 2 || first.Lost != 0 {
		t.Fatalf("erstes Fenster: n=%d lost=%d", first.N, first.Lost)
	}
	second := agg.Flush()
	if second.Lost != 5 {
		t.Fatalf("zweites Fenster sollte komplett leer sein: lost=%d", second.Lost)
	}
}

func TestAggregatorSequenceLoss(t *testing.T) {
	agg := &Aggregator{}
	// Fenster 1: 4 Antworten (Drift), lückenlos → kein Verlust.
	for seq := 1; seq <= 4; seq++ {
		agg.AddRtt(seq, 10)
	}
	if r := agg.Flush(); r.N != 4 || r.Lost != 0 {
		t.Fatalf("Fenster 1: n=%d lost=%d, erwartet 4/0", r.N, r.Lost)
	}
	// Fenster 2: 6 Antworten, lückenlos → kein Verlust.
	for seq := 5; seq <= 10; seq++ {
		agg.AddRtt(seq, 10)
	}
	if r := agg.Flush(); r.N != 6 || r.Lost != 0 {
		t.Fatalf("Fenster 2: n=%d lost=%d, erwartet 6/0", r.N, r.Lost)
	}
	// Fenster 3: 11 fehlt, 12 und 14 kommen, 13 fehlt → n=4, lost=2.
	agg.AddRtt(12, 10)
	agg.AddRtt(14, 10)
	if r := agg.Flush(); r.N != 4 || r.Lost != 2 {
		t.Fatalf("Fenster 3: n=%d lost=%d, erwartet 4/2", r.N, r.Lost)
	}
	// Fenster 4: nichts → komplett verloren; Fenster 5 zählt die Lücke nicht erneut.
	if r := agg.Flush(); r.N != ExpectedPingsPerWindow || r.Lost != ExpectedPingsPerWindow {
		t.Fatalf("Fenster 4: n=%d lost=%d", r.N, r.Lost)
	}
	for seq := 20; seq <= 24; seq++ {
		agg.AddRtt(seq, 10)
	}
	if r := agg.Flush(); r.N != 5 || r.Lost != 0 {
		t.Fatalf("Fenster 5: n=%d lost=%d, erwartet 5/0 (Lücke bereits in Fenster 4 gezählt)", r.N, r.Lost)
	}
	// Reconnect: Sequenz springt zurück → nur Lücke innerhalb des Fensters.
	agg.AddRtt(1, 10)
	agg.AddRtt(3, 10)
	if r := agg.Flush(); r.N != 3 || r.Lost != 1 {
		t.Fatalf("Reconnect: n=%d lost=%d, erwartet 3/1", r.N, r.Lost)
	}
}
