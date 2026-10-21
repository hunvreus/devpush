package agent

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func issueTestCertificate(t *testing.T, csrText string, name string, expires time.Time) string {
	t.Helper()
	block, _ := pem.Decode([]byte(csrText))
	if block == nil {
		t.Fatal("missing CSR")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if err = csr.CheckSignature(); err != nil {
		t.Fatal(err)
	}
	issuer, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: name}, DNSNames: []string{name}, NotBefore: time.Now().Add(-time.Hour), NotAfter: expires, KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, csr.PublicKey, issuer)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}
func TestManagedCertificatePollingPersistsKeyAcrossRestartAndLoadsTraefikFiles(t *testing.T) {
	var firstCSR string
	var polls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]string
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		if request["serverId"] != "server" || request["token"] != "credential" {
			t.Error("missing agent authentication")
		}
		for key, value := range request {
			if strings.Contains(value, "PRIVATE KEY") || key == "dnsToken" {
				t.Error("private material sent to hub")
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if request["csrPem"] == "" {
			json.NewEncoder(w).Encode(certificateResponse{Status: "configuration", DNSNames: []string{"*.web-acme.example.test"}})
			return
		}
		if firstCSR == "" {
			firstCSR = request["csrPem"]
		} else if firstCSR != request["csrPem"] {
			t.Error("key/CSR changed across restart")
		}
		polls++
		if polls == 1 {
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(certificateResponse{Status: "pending", RetryAfter: 1})
			return
		}
		json.NewEncoder(w).Encode(certificateResponse{Status: "ready", CertificatePEM: issueTestCertificate(t, request["csrPem"], "*.web-acme.example.test", time.Now().Add(90*24*time.Hour))})
	}))
	defer server.Close()
	cfg := Config{BaseURL: server.URL, AgentID: "server", Token: "credential", StateDir: t.TempDir()}
	first := NewRunner(cfg, nil)
	if err := first.syncManagedCertificate(context.Background()); err != nil {
		t.Fatal(err)
	}
	restarted := NewRunner(cfg, nil)
	if err := restarted.syncManagedCertificate(context.Background()); err != nil {
		t.Fatal(err)
	}
	names, err := restarted.managedCertificateNames()
	if err != nil || len(names) != 1 {
		t.Fatalf("certificate not installed: %v %v", names, err)
	}
	config, err := os.ReadFile(filepath.Join(restarted.certificateDirectory(), "dynamic", "certificates.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "PRIVATE KEY") || !strings.Contains(string(config), "/etc/devpush-certificates/") {
		t.Fatal("invalid Traefik configuration")
	}
	info, err := os.Stat(filepath.Join(restarted.certificateDirectory(), "request.json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("private key state permissions")
	}
}
func TestManagedCertificateRejectsWrongKeyNamesAndExpiry(t *testing.T) {
	runner := NewRunner(Config{StateDir: t.TempDir()}, nil)
	if err := os.MkdirAll(filepath.Join(runner.certificateDirectory(), "dynamic"), 0700); err != nil {
		t.Fatal(err)
	}
	state, err := newCertificateState("hub/server", "*.web-acme.example.test")
	if err != nil {
		t.Fatal(err)
	}
	other, err := newCertificateState("hub/server", "*.web-acme.example.test")
	if err != nil {
		t.Fatal(err)
	}
	for _, chain := range []string{
		issueTestCertificate(t, other.CSRPEM, state.Name, time.Now().Add(time.Hour)),
		issueTestCertificate(t, state.CSRPEM, "*.other.example.test", time.Now().Add(time.Hour)),
		issueTestCertificate(t, state.CSRPEM, state.Name, time.Now().Add(-time.Minute)),
	} {
		if runner.installManagedCertificate(state, chain) == nil {
			t.Fatal("accepted invalid managed certificate")
		}
	}
}
func TestManagedCertificateRoutesKeepCustomDomainACME(t *testing.T) {
	if !matchesManagedCertificate("shop.web-acme.example.test", []string{"*.web-acme.example.test"}) || matchesManagedCertificate("nested.shop.web-acme.example.test", []string{"*.web-acme.example.test"}) {
		t.Fatal("wildcard matching is not one label")
	}
	path := filepath.Join(t.TempDir(), "override.yml")
	if err := writeManagedComposeOverride(path, "shop", []route{{Host: "shop.web-acme.example.test", Service: "web", Path: "/", Port: 3000, HTTPS: true}, {Host: "custom.example.com", Service: "web", Path: "/", Port: 3000, HTTPS: true}}, nil, nil, "*.web-acme.example.test"); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(body), "certresolver=devpush") != 1 {
		t.Fatalf("custom domain ACME was changed: %s", body)
	}
}

func testManagedTLSReload(t *testing.T, runner *Runner, host string, httpsPort int, composePath string, projectName string) {
	t.Helper()
	state, err := newCertificateState("test/server", "*.example.test")
	if err != nil {
		t.Fatal(err)
	}
	chain := issueTestCertificate(t, state.CSRPEM, state.Name, time.Now().Add(90*24*time.Hour))
	if err = runner.installManagedCertificate(state, chain); err != nil {
		t.Fatal(err)
	}
	override := filepath.Join(filepath.Dir(composePath), "devpush.compose.yml")
	if err = writeManagedComposeOverride(override, projectName, []route{{Host: host, Service: "web", Path: "/", Port: 80, HTTPS: true}}, nil, nil, state.Name); err != nil {
		t.Fatal(err)
	}
	runTestCommand(t, filepath.Dir(composePath), "docker", "compose", "-p", projectName, "-f", composePath, "-f", override, "up", "-d", "--no-build")
	waitForCertificate := func(expected string) {
		block, _ := pem.Decode([]byte(expected))
		if block == nil {
			t.Fatal("invalid test chain")
		}
		// Test-only CA: compare the exact certificate and hostname after the handshake.
		transport := &http.Transport{TLSClientConfig: &tls.Config{ServerName: host, InsecureSkipVerify: true}, DisableKeepAlives: true}
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport, Timeout: 2 * time.Second}
		deadline := time.Now().Add(20 * time.Second)
		lastResult := "no response"
		for time.Now().Before(deadline) {
			request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, fmt.Sprintf("https://127.0.0.1:%d/", httpsPort), nil)
			if err != nil {
				t.Fatal(err)
			}
			request.Host = host
			response, err := client.Do(request)
			if err == nil {
				lastResult = response.Status
				if response.TLS != nil && len(response.TLS.PeerCertificates) > 0 {
					lastResult += " certificate=" + response.TLS.PeerCertificates[0].Subject.String()
				}
				response.Body.Close()
				if response.StatusCode == http.StatusOK && response.TLS != nil && len(response.TLS.PeerCertificates) > 0 && bytes.Equal(response.TLS.PeerCertificates[0].Raw, block.Bytes) && response.TLS.PeerCertificates[0].VerifyHostname(host) == nil {
					return
				}
			}
			if err != nil {
				lastResult = err.Error()
			}
			time.Sleep(150 * time.Millisecond)
		}
		logs, _ := exec.Command("docker", "logs", "--tail", "30", "devpush-traefik").CombinedOutput()
		t.Fatalf("Traefik did not serve the expected managed certificate: %s\n%s", lastResult, logs)
	}
	t.Log("Checking initial managed certificate")
	waitForCertificate(chain)
	replacement := issueTestCertificate(t, state.CSRPEM, state.Name, time.Now().Add(91*24*time.Hour))
	if err = runner.installManagedCertificate(state, replacement); err != nil {
		t.Fatal(err)
	}
	t.Log("Checking replaced managed certificate")
	waitForCertificate(replacement)
	t.Log("Managed HTTPS routing and atomic certificate reload passed through real Traefik.")
}

func TestManagedCertificatePendingReplacementDoesNotUseOldAcknowledgedCache(t *testing.T) {
	var received bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]string
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		if request["csrPem"] == "" {
			json.NewEncoder(w).Encode(certificateResponse{Status: "configuration", DNSNames: []string{"*.web-acme.example.test"}})
			return
		}
		received = true
		json.NewEncoder(w).Encode(certificateResponse{Status: "ready", CertificatePEM: issueTestCertificate(t, request["csrPem"], "*.web-acme.example.test", time.Now().Add(90*24*time.Hour))})
	}))
	defer server.Close()
	runner := NewRunner(Config{BaseURL: server.URL, AgentID: "server", Token: "credential", StateDir: t.TempDir()}, nil)
	directory := runner.certificateDirectory()
	if err := os.MkdirAll(filepath.Join(directory, "dynamic"), 0700); err != nil {
		t.Fatal(err)
	}
	identity := server.URL + "/server"
	old, err := newCertificateState(identity, "*.web-acme.example.test")
	if err != nil {
		t.Fatal(err)
	}
	if err = runner.installManagedCertificate(old, issueTestCertificate(t, old.CSRPEM, old.Name, time.Now().Add(90*24*time.Hour))); err != nil {
		t.Fatal(err)
	}
	installed, err := runner.installedManagedCertificate()
	if err != nil {
		t.Fatal(err)
	}
	installed.Acknowledged = true
	body, err := json.Marshal(installed)
	if err != nil {
		t.Fatal(err)
	}
	if err = writeAtomic(filepath.Join(directory, "installed.json"), body, 0600); err != nil {
		t.Fatal(err)
	}
	replacement, err := newCertificateState(identity, old.Name)
	if err != nil {
		t.Fatal(err)
	}
	body, err = json.Marshal(replacement)
	if err != nil {
		t.Fatal(err)
	}
	if err = writeAtomic(filepath.Join(directory, "request.json"), body, 0600); err != nil {
		t.Fatal(err)
	}
	runner.certificateNextAt = time.Time{}
	if err = runner.syncManagedCertificate(context.Background()); err != nil {
		t.Fatal(err)
	}
	installed, err = runner.installedManagedCertificate()
	if err != nil {
		t.Fatal(err)
	}
	if !received || installed.CSRHash != fmt.Sprintf("%x", sha256.Sum256([]byte(replacement.CSRPEM))) {
		t.Fatal("pending replacement was skipped because the old certificate was cached")
	}
}
