package agent

import (
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
	"os"
	"path/filepath"
	"strings"
	"time"
)

type certificateResponse struct {
	Status         string   `json:"status"`
	DNSNames       []string `json:"dnsNames"`
	RetryAfter     int      `json:"retryAfter"`
	CertificatePEM string   `json:"certificatePem"`
	ExpiresAt      string   `json:"expiresAt"`
}
type certificateState struct {
	Identity string `json:"identity"`
	Name     string `json:"name"`
	KeyPEM   string `json:"keyPem"`
	CSRPEM   string `json:"csrPem"`
}
type installedCertificate struct {
	RenewAt         time.Time `json:"renewAt"`
	CSRHash         string    `json:"csrHash"`
	CertificateFile string    `json:"certificateFile"`
	KeyFile         string    `json:"keyFile"`
	Name            string    `json:"name"`
	ExpiresAt       time.Time `json:"expiresAt"`
	Fingerprint     string    `json:"fingerprint"`
	Acknowledged    bool      `json:"acknowledged"`
}

func validCertificateName(name string) bool {
	if !strings.HasPrefix(name, "*.") || len(name) > 253 {
		return false
	}
	for _, label := range strings.Split(name[2:], ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if !(char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-') {
				return false
			}
		}
	}
	return strings.Contains(name[2:], ".")
}
func newCertificateState(identity, name string) (certificateState, error) {
	if !validCertificateName(name) {
		return certificateState{}, fmt.Errorf("invalid managed certificate DNS name")
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return certificateState{}, err
	}
	raw, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return certificateState{}, err
	}
	csr, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: name}, DNSNames: []string{name}}, key)
	if err != nil {
		return certificateState{}, err
	}
	return certificateState{Identity: identity, Name: name, KeyPEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: raw})), CSRPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csr}))}, nil
}
func (runner *Runner) certificateDirectory() string {
	return filepath.Join(runner.cfg.StateDir, "ingress-certificates")
}
func (runner *Runner) syncManagedCertificate(ctx context.Context) error {
	if time.Now().Before(runner.certificateNextAt) {
		return nil
	}
	runner.certificateNextAt = time.Now().Add(time.Minute)
	var configuration certificateResponse
	payload := map[string]string{"serverId": runner.cfg.AgentID, "token": runner.currentCredential()}
	if err := runner.post(ctx, "/api/agents/certificates", payload, &configuration); err != nil {
		return fmt.Errorf("request managed certificate configuration: %w", err)
	}
	if configuration.Status != "configuration" || len(configuration.DNSNames) != 1 || !validCertificateName(configuration.DNSNames[0]) {
		return fmt.Errorf("invalid managed certificate configuration")
	}
	name := configuration.DNSNames[0]
	directory := runner.certificateDirectory()
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(directory, "dynamic"), 0700); err != nil {
		return err
	}
	if err := os.Chmod(directory, 0700); err != nil {
		return err
	}
	installed, err := runner.installedManagedCertificate()
	if err != nil {
		installed = nil
	}

	path := filepath.Join(directory, "request.json")
	state := certificateState{}
	body, err := os.ReadFile(path)
	if err == nil {
		if err = json.Unmarshal(body, &state); err != nil {
			return fmt.Errorf("invalid persisted certificate request")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	identity := runner.cfg.BaseURL + "/" + runner.cfg.AgentID
	if state.Name != name || state.Identity != identity {
		installed = nil
		state, err = newCertificateState(identity, name)
		if err != nil {
			return err
		}
		body, err = json.Marshal(state)
		if err != nil {
			return err
		}
		if err = writeAtomic(path, body, 0600); err != nil {
			return err
		}
	}
	payload["csrPem"] = state.CSRPEM
	if installed != nil && installed.Name == name && installed.CSRHash == fmt.Sprintf("%x", sha256.Sum256([]byte(state.CSRPEM))) && time.Now().Before(installed.RenewAt) {
		if !installed.Acknowledged {
			return runner.acknowledgeManagedCertificate(ctx, payload, installed)
		}
		runner.certificateNextAt = nextManagedCertificateCheck(installed)
		return nil
	}
	// Persist the private key and CSR before the first issuance request.
	payload["csrPem"] = state.CSRPEM
	var result certificateResponse
	if err = runner.post(ctx, "/api/agents/certificates", payload, &result); err != nil {
		return fmt.Errorf("request managed certificate: %w", err)
	}
	if result.Status == "pending" {
		if result.RetryAfter < 1 || result.RetryAfter > 3600 {
			return fmt.Errorf("invalid certificate retry interval")
		}
		runner.certificateNextAt = time.Now().Add(time.Duration(result.RetryAfter) * time.Second)
		return nil
	}
	if result.Status != "ready" || len(result.CertificatePEM) > 65536 {
		return fmt.Errorf("invalid managed certificate response")
	}
	if err := runner.installManagedCertificate(state, result.CertificatePEM); err != nil {
		return err
	}
	installed, err = runner.installedManagedCertificate()
	if err != nil {
		return err
	}
	return runner.acknowledgeManagedCertificate(ctx, payload, installed)
}
func (runner *Runner) installManagedCertificate(state certificateState, chain string) error {
	pair, err := tls.X509KeyPair([]byte(chain), []byte(state.KeyPEM))
	if err != nil {
		return fmt.Errorf("managed certificate does not match local key")
	}
	certificate, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return fmt.Errorf("invalid managed certificate")
	}
	if certificate.IsCA || !certificate.NotBefore.Before(certificate.NotAfter) || len(certificate.DNSNames) != 1 || certificate.DNSNames[0] != state.Name || time.Until(certificate.NotAfter) <= 0 || certificate.NotBefore.After(time.Now().Add(5*time.Minute)) {
		return fmt.Errorf("managed certificate names or validity do not match")
	}
	if err = certificate.VerifyHostname("probe." + strings.TrimPrefix(state.Name, "*.")); err != nil {
		return fmt.Errorf("managed certificate hostname does not match")
	}
	// The hub is authenticated by the control-plane connection. Never accept keys from it.
	directory := runner.certificateDirectory()
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(chain)))[:16]
	certName, keyName := "certificate-"+digest+".pem", "key-"+digest+".pem"
	if err = writeAtomic(filepath.Join(directory, certName), []byte(chain), 0600); err != nil {
		return err
	}
	if err = writeAtomic(filepath.Join(directory, keyName), []byte(state.KeyPEM), 0600); err != nil {
		return err
	}
	body := managedCertificateConfiguration(certName, keyName)
	if err = writeAtomic(filepath.Join(directory, "dynamic", "certificates.yaml"), body, 0600); err != nil {
		return err
	}
	body, err = json.Marshal(installedCertificate{RenewAt: managedCertificateRenewAt(certificate), CSRHash: fmt.Sprintf("%x", sha256.Sum256([]byte(state.CSRPEM))), CertificateFile: certName, KeyFile: keyName, Name: state.Name, ExpiresAt: certificate.NotAfter, Fingerprint: fmt.Sprintf("%x", sha256.Sum256(certificate.Raw))})
	if err != nil {
		return err
	}
	if err = writeAtomic(filepath.Join(directory, "installed.json"), body, 0600); err != nil {
		return err
	}
	runner.certificateNextAt = time.Now().Add(6 * time.Hour)
	return nil
}
func (runner *Runner) installedManagedCertificate() (*installedCertificate, error) {
	body, err := os.ReadFile(filepath.Join(runner.certificateDirectory(), "installed.json"))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var installed installedCertificate
	if json.Unmarshal(body, &installed) != nil || !validCertificateName(installed.Name) {
		return nil, fmt.Errorf("invalid installed certificate metadata")
	}
	for _, name := range []string{installed.CertificateFile, installed.KeyFile} {
		if name == "" || filepath.Base(name) != name {
			return nil, fmt.Errorf("invalid managed certificate filename")
		}
	}
	directory := runner.certificateDirectory()
	chain, err := os.ReadFile(filepath.Join(directory, installed.CertificateFile))
	if err != nil {
		return nil, err
	}
	key, err := os.ReadFile(filepath.Join(directory, installed.KeyFile))
	if err != nil {
		return nil, err
	}
	pair, err := tls.X509KeyPair(chain, key)
	if err != nil {
		return nil, fmt.Errorf("invalid stored managed certificate pair")
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, err
	}
	if fmt.Sprintf("%x", sha256.Sum256(leaf.Raw)) != installed.Fingerprint || !leaf.NotAfter.Equal(installed.ExpiresAt) || !managedCertificateRenewAt(leaf).Equal(installed.RenewAt) || len(leaf.DNSNames) != 1 || leaf.DNSNames[0] != installed.Name {
		return nil, fmt.Errorf("stored managed certificate metadata does not match")
	}
	// The watched configuration may already reference the next valid version
	// while the installation metadata is being atomically replaced.
	if _, err := os.Stat(filepath.Join(directory, "dynamic", "certificates.yaml")); err != nil {
		return nil, err
	}
	return &installed, nil
}
func (runner *Runner) managedCertificateNames() ([]string, error) {
	installed, err := runner.installedManagedCertificate()
	if err != nil {
		return nil, err
	}
	if installed == nil {
		return nil, nil
	}
	// Keep matching managed names even during renewal failures; never fall back to HTTP-01 for them.
	return []string{installed.Name}, nil
}
func matchesManagedCertificate(host string, names []string) bool {
	for _, name := range names {
		suffix := strings.TrimPrefix(name, "*")
		if strings.HasSuffix(host, suffix) && !strings.Contains(strings.TrimSuffix(host, suffix), ".") && len(host) > len(suffix) {
			return true
		}
	}
	return false
}

func (runner *Runner) acknowledgeManagedCertificate(ctx context.Context, payload map[string]string, installed *installedCertificate) error {
	if installed == nil {
		return fmt.Errorf("managed certificate installation is missing")
	}
	runner.certificateNextAt = time.Now().Add(time.Minute)
	payload["installedCertificateSha256"] = installed.Fingerprint
	var response certificateResponse
	if err := runner.post(ctx, "/api/agents/certificates", payload, &response); err != nil {
		return err
	}
	if response.Status != "ready" {
		return fmt.Errorf("managed certificate acknowledgement is pending")
	}
	installed.Acknowledged = true
	body, err := json.Marshal(installed)
	if err != nil {
		return err
	}
	if err = writeAtomic(filepath.Join(runner.certificateDirectory(), "installed.json"), body, 0600); err != nil {
		return err
	}
	runner.certificateNextAt = nextManagedCertificateCheck(installed)
	return nil
}

func managedCertificateConfiguration(certName, keyName string) []byte {
	return []byte(fmt.Sprintf("tls:\n  certificates:\n    - certFile: %q\n      keyFile: %q\n", "/etc/devpush-certificates/"+certName, "/etc/devpush-certificates/"+keyName))
}

func managedCertificateRenewAt(certificate *x509.Certificate) time.Time {
	buffer := certificate.NotAfter.Sub(certificate.NotBefore) / 3
	if buffer > 30*24*time.Hour {
		buffer = 30 * 24 * time.Hour
	}
	return certificate.NotAfter.Add(-buffer)
}
func nextManagedCertificateCheck(installed *installedCertificate) time.Time {
	next := time.Now().Add(6 * time.Hour)
	if installed.RenewAt.Before(next) {
		next = installed.RenewAt
	}
	return next
}
