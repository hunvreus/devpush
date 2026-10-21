package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscoverPublicAddress(t *testing.T) {
	for _, value := range []string{"203.0.113.10", "127.0.0.1", "192.168.1.1", "bad", "2001:db8::1"} {
		t.Run(value, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(value)) }))
			defer server.Close()
			address, err := discoverPublicAddress(context.Background(), "tcp4", server.URL)
			if value == "203.0.113.10" {
				if err != nil || address != value {
					t.Fatalf("address=%q error=%v", address, err)
				}
			} else if err == nil {
				t.Fatalf("accepted %q", value)
			}
		})
	}
}

func TestRegistrationReportsCachedPublicAddresses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload agentRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload.PublicIpv4 != "203.0.113.10" || payload.PublicIpv6 != "2001:db8::10" {
			t.Errorf("wrong addresses: %+v", payload)
		}
		writeJSON(t, w, agentResponse{ServerID: "server-1", Status: "connected"})
	}))
	defer server.Close()
	runner := NewRunner(Config{BaseURL: server.URL, Token: "token", StateDir: t.TempDir()}, nil)
	runner.publicIpv4 = "203.0.113.10"
	runner.publicIpv6 = "2001:db8::10"
	if _, err := runner.register(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestFailedDiscoveryRetainsCachedFamilies(t *testing.T) {
	runner := NewRunner(Config{}, nil)
	runner.publicIpv4 = "203.0.113.10"
	runner.publicIpv6 = "2001:db8::10"
	runner.discoverAddress = func(context.Context, string, string) (string, error) { return "", fmt.Errorf("offline") }
	runner.refreshPublicAddresses(context.Background())
	ipv4, ipv6 := runner.publicAddresses()
	if ipv4 != "203.0.113.10" || ipv6 != "2001:db8::10" {
		t.Fatalf("lost known addresses: %s %s", ipv4, ipv6)
	}
}

func TestPinnedAddressSkipsDiscovery(t *testing.T) {
	for _, address := range []string{"192.168.64.7", "2001:db8::7"} {
		t.Run(address, func(t *testing.T) {
			runner := NewRunner(Config{RoutingAddress: address}, nil)
			runner.discoverAddress = func(context.Context, string, string) (string, error) {
				t.Fatal("pinned address must not use discovery")
				return "", nil
			}
			runner.publicIpv4, runner.publicIpv6 = "203.0.113.9", "2001:db8::9"
			runner.refreshPublicAddresses(context.Background())
			runner.refreshPublicAddressLoop(context.Background())
			ipv4, ipv6 := runner.publicAddresses()
			if address == "192.168.64.7" && (ipv4 != address || ipv6 != "") {
				t.Fatalf("wrong pinned family: %s %s", ipv4, ipv6)
			}
			if address == "2001:db8::7" && (ipv6 != address || ipv4 != "") {
				t.Fatalf("wrong pinned family: %s %s", ipv4, ipv6)
			}
		})
	}
}
