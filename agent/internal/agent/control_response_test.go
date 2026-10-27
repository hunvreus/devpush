package agent

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestControlPlaneResponseBounds(t *testing.T) {
	for _, test := range []struct {
		name, body string
		oversized  bool
	}{
		{name: "valid", body: `{"ok":true}`},
		{name: "trailing payload", body: `{"ok":true}{"secret":"ignored before"}`},
		{name: "oversized", oversized: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if test.oversized {
					_, _ = io.WriteString(w, `{"value":"`)
					chunk := strings.Repeat("x", 64*1024)
					for i := 0; i < 257; i++ {
						if _, err := io.WriteString(w, chunk); err != nil {
							return
						}
					}
					_, _ = io.WriteString(w, `"}`)
					return
				}
				_, _ = fmt.Fprint(w, test.body)
			}))
			defer server.Close()
			runner := NewRunner(Config{BaseURL: server.URL}, nil)
			var response struct {
				Ok bool `json:"ok"`
			}
			err := runner.post(t.Context(), "/response", struct{}{}, &response)
			if test.name == "valid" {
				if err != nil || !response.Ok {
					t.Fatalf("valid response failed: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("accepted invalid response")
			}
			if test.oversized && !strings.Contains(err.Error(), "exceeds") {
				t.Fatalf("missing size error: %v", err)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("echoed response payload")
			}
		})
	}
}

func TestControlPlaneResponseAtLimitIsAccepted(t *testing.T) {
	const limit = 16 * 1024 * 1024
	const object = `{"ok":true}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(limit))
		_, _ = io.WriteString(w, object)
		padding := strings.Repeat(" ", 64*1024)
		remaining := limit - len(object)
		for remaining > 0 {
			count := len(padding)
			if remaining < count {
				count = remaining
			}
			if _, err := io.WriteString(w, padding[:count]); err != nil {
				return
			}
			remaining -= count
		}
	}))
	defer server.Close()
	runner := NewRunner(Config{BaseURL: server.URL}, nil)
	var response struct {
		Ok bool `json:"ok"`
	}
	if err := runner.post(t.Context(), "/response", struct{}{}, &response); err != nil || !response.Ok {
		t.Fatalf("boundary response rejected: %v", err)
	}
}
