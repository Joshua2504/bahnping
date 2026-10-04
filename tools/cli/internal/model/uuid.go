package model

import (
	"crypto/rand"
	"fmt"
)

// NewID erzeugt eine zufällige UUIDv4 (client-generierte Sample-ID, macht Uploads
// idempotent, siehe SampleBase.id in schemas.ts). Kein externes UUID-Paket nötig.
func NewID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand.Read schlägt praktisch nie fehl; Fallback unten wäre nur Zierde.
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // Version 4
	b[8] = (b[8] & 0x3f) | 0x80 // Variante RFC 4122
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
