package tui

import (
	"context"
	"os"

	"golang.org/x/term"
)

// KeyReader liest einzelne Tastendrücke vom Terminal im Raw-Modus (ohne Enter),
// damit "s" (Speedtest) und "q" (Beenden) sofort reagieren. Nicht nutzbar, wenn
// stdin kein Terminal ist (z.B. --plain in einer Pipe) – dann liefert Start(...)
// einen Fehler, den der Aufrufer ignorieren kann (Tastatursteuerung ist optional).
type KeyReader struct {
	fd       int
	oldState *term.State
	keys     chan rune
}

// NewKeyReader prüft, ob stdin ein Terminal ist, und aktiviert bei Erfolg den Raw-Modus.
func NewKeyReader() (*KeyReader, error) {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return nil, errNotATerminal
	}
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return nil, err
	}
	kr := &KeyReader{fd: fd, oldState: oldState, keys: make(chan rune, 8)}
	go kr.readLoop()
	return kr, nil
}

var errNotATerminal = errNotTTY{}

type errNotTTY struct{}

func (errNotTTY) Error() string { return "stdin ist kein Terminal" }

func (k *KeyReader) readLoop() {
	buf := make([]byte, 1)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			close(k.keys)
			return
		}
		if n > 0 {
			select {
			case k.keys <- rune(buf[0]):
			default:
			}
		}
	}
}

// Keys liefert den Kanal mit eingegebenen Tasten.
func (k *KeyReader) Keys() <-chan rune { return k.keys }

// Close stellt den ursprünglichen Terminal-Modus wieder her.
func (k *KeyReader) Close() error {
	if k.oldState == nil {
		return nil
	}
	return term.Restore(k.fd, k.oldState)
}

// Wait ist ein kleiner Helfer, falls der Aufrufer bis ctx.Done() oder einer Taste warten will.
func Wait(ctx context.Context, keys <-chan rune) (rune, bool) {
	select {
	case <-ctx.Done():
		return 0, false
	case r, ok := <-keys:
		return r, ok
	}
}
