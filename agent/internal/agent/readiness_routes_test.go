package agent

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDeploymentReadinessChecksEveryAliasAndPath(t *testing.T) {
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Host+r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	_, value, _ := net.SplitHostPort(server.Listener.Addr().String())
	port, _ := strconv.Atoi(value)
	runner := NewRunner(Config{TraefikHTTPPort: port}, nil)
	routes := []route{
		{Host: "project.example.com", Path: "/", Port: 80},
		{Host: "deployment.example.com", Path: "/", Port: 80},
		{Host: "branch.example.com", Path: "/", Port: 80},
		{Host: "project.example.com", Path: "/api", Port: 8080},
		{Host: "project.example.com", Path: "/", Port: 80},
	}
	if err := runner.checkDeploymentRoutes(t.Context(), routes, "/health", func(string, string) {}); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 4 {
		t.Fatalf("expected four distinct checks, got %v", requests)
	}
	if requests[1] != "deployment.example.com/health" || requests[2] != "branch.example.com/health" || requests[3] != "project.example.com/api/health" {
		t.Fatalf("aliases or paths were skipped: %v", requests)
	}
}

func TestDeploymentReadinessRejectsFailedSecondaryAlias(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host == "deployment.example.com" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	_, value, _ := net.SplitHostPort(server.Listener.Addr().String())
	port, _ := strconv.Atoi(value)
	runner := NewRunner(Config{TraefikHTTPPort: port}, nil)
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	err := runner.checkDeploymentRoutes(ctx, []route{{Host: "project.example.com", Path: "/", Port: 80}, {Host: "deployment.example.com", Path: "/", Port: 80}}, "/health", func(string, string) {})
	if err == nil || !strings.Contains(err.Error(), "deployment.example.com/health") {
		t.Fatalf("expected secondary alias failure, got %v", err)
	}
}
