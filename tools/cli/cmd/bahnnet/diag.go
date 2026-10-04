package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

// cmdDiag prüft bekannte Zug-WLAN-Endpunkte und zeigt Status, Content-Type und den Anfang der Antwort.
// Dient dazu, im Zug schnell zu sehen, welche Portal-API erreichbar ist und wie sie antwortet.
func cmdDiag(_ []string) error {
	hosts := []string{"iceportal.de", "www.iceportal.de", "login.wifionice.de", "wifi.bahn.de", "portal.wifionice.de"}
	fmt.Println("DNS:")
	for _, h := range hosts {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		addrs, err := net.DefaultResolver.LookupHost(ctx, h)
		cancel()
		if err != nil {
			fmt.Printf("  %-22s Fehler: %v\n", h, err)
		} else {
			fmt.Printf("  %-22s %s\n", h, strings.Join(addrs, ", "))
		}
	}
	urls := []string{
		"https://iceportal.de/api1/rs/status",
		"https://iceportal.de/api1/rs/tripInfo/trip",
		"http://iceportal.de/api1/rs/status",
		"https://www.iceportal.de/api1/rs/status",
		"https://login.wifionice.de/usage_info/",
		"https://login.wifionice.de/cna/wifi_connect",
		"https://wifi.bahn.de/",
	}
	client := &http.Client{
		Timeout: 6 * time.Second,
		// Weiterleitungen anzeigen statt folgen
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	fmt.Println("\nHTTP:")
	for _, u := range urls {
		req, _ := http.NewRequest(http.MethodGet, u, nil)
		req.Header.Set("Accept", "application/json, text/html;q=0.9")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) bahnnet")
		start := time.Now()
		resp, err := client.Do(req)
		if err != nil {
			fmt.Printf("  %s\n    Fehler: %v\n", u, err)
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 600))
		resp.Body.Close()
		fmt.Printf("  %s\n    %d  %s  %dms", u, resp.StatusCode, resp.Header.Get("Content-Type"), time.Since(start).Milliseconds())
		if loc := resp.Header.Get("Location"); loc != "" {
			fmt.Printf("  → %s", loc)
		}
		fmt.Printf("\n    %s\n", strings.Join(strings.Fields(string(body)), " "))
	}
	return nil
}
