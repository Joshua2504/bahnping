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

func TestComputePartialWindowLost(t *testing.T) {
	// Nur 2 von 5 erwarteten Pings beantwortet.
	res := Compute([]float64{10, 20})
	if res.N != 5 || res.Lost != 3 {
		t.Fatalf("lost falsch: n=%d lost=%d", res.N, res.Lost)
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
	agg.AddRtt(10)
	agg.AddRtt(20)
	first := agg.Flush()
	if first.Lost != 3 {
		t.Fatalf("erstes Fenster: lost=%d", first.Lost)
	}
	second := agg.Flush()
	if second.Lost != 5 {
		t.Fatalf("zweites Fenster sollte komplett leer sein: lost=%d", second.Lost)
	}
}
