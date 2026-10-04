package outbox

import (
	"testing"

	"github.com/treudler/bahnnet-cli/internal/model"
)

func sampleWithID(id string) model.Sample {
	return model.Sample{ID: id, Ts: 1, Kind: model.SampleKindProbe, PosSource: "none"}
}

func TestAppendAndCount(t *testing.T) {
	dir := t.TempDir()
	ob, err := Open(dir, "trip-1")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err := ob.Append(sampleWithID(string(rune('a' + i)))); err != nil {
			t.Fatal(err)
		}
	}
	n, err := ob.Count()
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 {
		t.Fatalf("erwarte 3 Einträge, got %d", n)
	}
}

func TestRemoveFrontKeepsOrderAndRest(t *testing.T) {
	dir := t.TempDir()
	ob, err := Open(dir, "trip-2")
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{"a", "b", "c", "d"}
	for _, id := range ids {
		if err := ob.Append(sampleWithID(id)); err != nil {
			t.Fatal(err)
		}
	}
	if err := ob.RemoveFront(2); err != nil {
		t.Fatal(err)
	}
	rest, err := ob.Peek(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rest) != 2 || rest[0].ID != "c" || rest[1].ID != "d" {
		t.Fatalf("Rest falsch: %+v", rest)
	}
}

func TestRemoveFrontMoreThanAvailable(t *testing.T) {
	dir := t.TempDir()
	ob, err := Open(dir, "trip-3")
	if err != nil {
		t.Fatal(err)
	}
	if err := ob.Append(sampleWithID("a")); err != nil {
		t.Fatal(err)
	}
	if err := ob.RemoveFront(5); err != nil {
		t.Fatal(err)
	}
	n, err := ob.Count()
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("erwarte 0 nach Überschuss-RemoveFront, got %d", n)
	}
}

func TestPersistsAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	ob, err := Open(dir, "trip-4")
	if err != nil {
		t.Fatal(err)
	}
	if err := ob.Append(sampleWithID("x")); err != nil {
		t.Fatal(err)
	}
	// Simuliert einen Neustart des Programms: neue Outbox-Instanz, gleiche Datei.
	ob2, err := Open(dir, "trip-4")
	if err != nil {
		t.Fatal(err)
	}
	n, err := ob2.Count()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("erwarte 1 nach Neuöffnen, got %d", n)
	}
}

func TestFindExisting(t *testing.T) {
	dir := t.TempDir()
	if _, err := Open(dir, "trip-5"); err != nil {
		t.Fatal(err)
	}
	if _, err := Open(dir, "trip-6"); err != nil {
		t.Fatal(err)
	}
	paths, err := FindExisting(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 2 {
		t.Fatalf("erwarte 2 gefundene Outbox-Dateien, got %d: %v", len(paths), paths)
	}
}

func TestRemoveDeletesFile(t *testing.T) {
	dir := t.TempDir()
	ob, err := Open(dir, "trip-7")
	if err != nil {
		t.Fatal(err)
	}
	if err := ob.Append(sampleWithID("a")); err != nil {
		t.Fatal(err)
	}
	if err := ob.Remove(); err != nil {
		t.Fatal(err)
	}
	paths, err := FindExisting(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 0 {
		t.Fatalf("Outbox sollte gelöscht sein, gefunden: %v", paths)
	}
}
