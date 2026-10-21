package agent

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

func discoverPublicAddress(ctx context.Context, family string, endpoint string) (string, error) {
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, address string) (net.Conn, error) {
		return dialer.DialContext(ctx, family, address)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 128))
	if err != nil {
		return "", err
	}
	address := strings.TrimSpace(string(body))
	ip := net.ParseIP(address)
	if response.StatusCode != 200 || ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || (family == "tcp4") != (ip.To4() != nil) {
		return "", fmt.Errorf("invalid public %s address", family)
	}
	return ip.String(), nil
}
func (runner *Runner) publicAddresses() (string, string) {
	if address := runner.cfg.RoutingAddress; address != "" {
		if net.ParseIP(address).To4() != nil {
			return address, ""
		}
		return "", address
	}
	runner.addressMu.RLock()
	defer runner.addressMu.RUnlock()
	return runner.publicIpv4, runner.publicIpv6
}
func (runner *Runner) refreshPublicAddresses(ctx context.Context) {
	if runner.cfg.RoutingAddress != "" {
		return
	}
	for _, lookup := range []struct{ family, endpoint string }{{"tcp4", "https://api.ipify.org"}, {"tcp6", "https://api6.ipify.org"}} {
		address, err := runner.discoverAddress(ctx, lookup.family, lookup.endpoint)
		if err != nil {
			runner.log.Debug("public address discovery unavailable", "family", lookup.family, "error", err)
			continue
		}
		runner.addressMu.Lock()
		if lookup.family == "tcp4" {
			runner.publicIpv4 = address
		} else {
			runner.publicIpv6 = address
		}
		runner.addressMu.Unlock()
	}
}
func (runner *Runner) refreshPublicAddressLoop(ctx context.Context) {
	if runner.cfg.RoutingAddress != "" {
		return
	}
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runner.refreshPublicAddresses(ctx)
		}
	}
}
