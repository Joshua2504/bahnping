package iceportal

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// curlMarker trennt Body und HTTP-Status in der curl-Ausgabe.
const curlMarker = "\n__BAHNNET_HTTP_STATUS__:"

// curlGet holt eine URL über /usr/bin/curl. Wird nur unter macOS genutzt, wenn die direkte
// Verbindung durch die Berechtigung "Lokales Netzwerk" blockiert ist.
func curlGet(ctx context.Context, url string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "/usr/bin/curl",
		"-sS", "--max-time", "5",
		"-H", "Accept: application/json",
		"-A", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) bahnnet",
		"-w", curlMarker+"%{http_code}",
		url)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("curl: %s", msg)
	}
	return parseCurlOutput(out)
}

func parseCurlOutput(out []byte) ([]byte, error) {
	i := bytes.LastIndex(out, []byte(curlMarker))
	if i < 0 {
		return nil, fmt.Errorf("curl: unerwartete Ausgabe")
	}
	body := out[:i]
	code, err := strconv.Atoi(strings.TrimSpace(string(out[i+len(curlMarker):])))
	if err != nil {
		return nil, fmt.Errorf("curl: Statuscode unlesbar")
	}
	if code >= 400 || code == 0 {
		return nil, fmt.Errorf("HTTP %d", code)
	}
	return body, nil
}
