package agent

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func (runner *Runner) collectHostMetrics(ctx context.Context) *hostMetrics {
	metrics := hostMetrics{}

	if cpuPercent, err := sampleCPUPercent(ctx); err == nil {
		metrics.CPUPercent = &cpuPercent
	} else {
		runner.log.Debug("cpu metric unavailable", "error", err)
	}
	if used, total, err := readMemoryUsage(); err == nil {
		metrics.MemoryUsedBytes = &used
		metrics.MemoryTotalBytes = &total
	} else {
		runner.log.Debug("memory metric unavailable", "error", err)
	}
	if used, total, err := readDiskUsage("/"); err == nil {
		metrics.DiskUsedBytes = &used
		metrics.DiskTotalBytes = &total
	} else {
		runner.log.Debug("disk metric unavailable", "error", err)
	}
	if received, sent, ok := runner.collectNetworkRates(); ok {
		metrics.NetworkReceiveBytesPerSecond = &received
		metrics.NetworkTransmitBytesPerSecond = &sent
	}
	if read, written, ok := runner.collectDiskIORates(); ok {
		metrics.DiskReadBytesPerSecond = &read
		metrics.DiskWriteBytesPerSecond = &written
	}
	if !metrics.hasValues() {
		return nil
	}
	return &metrics
}

func collectHostDetails() *hostDetails {
	details := &hostDetails{
		OperatingSystem: runtime.GOOS,
		Architecture:    runtime.GOARCH,
		CPUCoreCount:    runtime.NumCPU(),
	}
	if hostname, err := os.Hostname(); err == nil {
		details.Hostname = hostname
	}
	if operatingSystem := readOSPrettyName(); operatingSystem != "" {
		details.OperatingSystem = operatingSystem
	}
	if content, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		details.KernelVersion = strings.TrimSpace(string(content))
	}
	if uptime, err := readHostUptime(); err == nil {
		details.UptimeSeconds = &uptime
	}
	return details
}

func readOSPrettyName() string {
	content, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(content), "\n") {
		value, ok := strings.CutPrefix(line, "PRETTY_NAME=")
		if ok {
			return strings.Trim(strings.TrimSpace(value), `"`)
		}
	}
	return ""
}

func readHostUptime() (uint64, error) {
	content, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(content))
	if len(fields) == 0 {
		return 0, errors.New("invalid /proc/uptime")
	}
	seconds, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || seconds < 0 {
		return 0, errors.New("invalid /proc/uptime value")
	}
	return uint64(seconds), nil
}

func (runner *Runner) collectNetworkRates() (float64, float64, bool) {
	received, sent, err := readNetworkTotals()
	if err != nil {
		runner.log.Debug("network metric unavailable", "error", err)
		return 0, 0, false
	}
	now := time.Now()
	previousAt := runner.lastNetworkReadAt
	previousReceived := runner.lastNetworkRecv
	previousSent := runner.lastNetworkSent
	runner.lastNetworkReadAt = now
	runner.lastNetworkRecv = received
	runner.lastNetworkSent = sent
	if previousAt.IsZero() || received < previousReceived || sent < previousSent {
		return 0, 0, false
	}
	elapsed := now.Sub(previousAt).Seconds()
	if elapsed <= 0 {
		return 0, 0, false
	}
	return roundMetric(float64(received-previousReceived) / elapsed),
		roundMetric(float64(sent-previousSent) / elapsed), true
}

func readNetworkTotals() (uint64, uint64, error) {
	content, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return 0, 0, err
	}
	var received uint64
	var sent uint64
	for _, line := range strings.Split(string(content), "\n") {
		name, values, ok := strings.Cut(line, ":")
		if !ok || !isMonitoredNetworkInterface(strings.TrimSpace(name)) {
			continue
		}
		fields := strings.Fields(values)
		if len(fields) < 9 {
			continue
		}
		recvValue, recvErr := strconv.ParseUint(fields[0], 10, 64)
		sentValue, sentErr := strconv.ParseUint(fields[8], 10, 64)
		if recvErr == nil && sentErr == nil {
			received += recvValue
			sent += sentValue
		}
	}
	return received, sent, nil
}

func isMonitoredNetworkInterface(name string) bool {
	if name == "" || name == "lo" {
		return false
	}
	for _, prefix := range []string{"br-", "docker", "veth", "virbr"} {
		if strings.HasPrefix(name, prefix) {
			return false
		}
	}
	return true
}

func (runner *Runner) collectDiskIORates() (float64, float64, bool) {
	read, written, err := readDiskIOTotals()
	if err != nil {
		runner.log.Debug("disk I/O metric unavailable", "error", err)
		return 0, 0, false
	}
	now := time.Now()
	previousAt := runner.lastDiskReadAt
	previousRead := runner.lastDiskReadBytes
	previousWritten := runner.lastDiskWriteBytes
	runner.lastDiskReadAt = now
	runner.lastDiskReadBytes = read
	runner.lastDiskWriteBytes = written
	if previousAt.IsZero() || read < previousRead || written < previousWritten {
		return 0, 0, false
	}
	elapsed := now.Sub(previousAt).Seconds()
	if elapsed <= 0 {
		return 0, 0, false
	}
	return roundMetric(float64(read-previousRead) / elapsed),
		roundMetric(float64(written-previousWritten) / elapsed), true
}

func readDiskIOTotals() (uint64, uint64, error) {
	content, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return 0, 0, err
	}
	var read uint64
	var written uint64
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 || !isMonitoredBlockDevice(fields[2]) {
			continue
		}
		readSectors, readErr := strconv.ParseUint(fields[5], 10, 64)
		writtenSectors, writeErr := strconv.ParseUint(fields[9], 10, 64)
		if readErr == nil && writeErr == nil {
			read += readSectors * 512
			written += writtenSectors * 512
		}
	}
	return read, written, nil
}

func isMonitoredBlockDevice(name string) bool {
	if name == "" {
		return false
	}
	for _, prefix := range []string{"loop", "ram", "fd", "sr", "dm-", "md"} {
		if strings.HasPrefix(name, prefix) {
			return false
		}
	}
	_, err := os.Stat(filepath.Join("/sys/class/block", name, "partition"))
	return errors.Is(err, os.ErrNotExist)
}

func sampleCPUPercent(ctx context.Context) (float64, error) {
	first, err := readCPUStat()
	if err != nil {
		return 0, err
	}
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return 0, ctx.Err()
	case <-timer.C:
	}
	second, err := readCPUStat()
	if err != nil {
		return 0, err
	}
	totalDelta := second.total - first.total
	idleDelta := second.idle - first.idle
	if totalDelta <= 0 {
		return 0, errors.New("cpu total did not advance")
	}
	return roundMetric(100 * float64(totalDelta-idleDelta) / float64(totalDelta)), nil
}

type cpuStat struct {
	total uint64
	idle  uint64
}

func readCPUStat() (cpuStat, error) {
	content, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuStat{}, err
	}
	line, _, _ := strings.Cut(string(content), "\n")
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return cpuStat{}, errors.New("invalid /proc/stat cpu line")
	}
	values := make([]uint64, 0, len(fields)-1)
	for _, field := range fields[1:] {
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return cpuStat{}, err
		}
		values = append(values, value)
	}
	var total uint64
	for _, value := range values {
		total += value
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return cpuStat{total: total, idle: idle}, nil
}

func readMemoryUsage() (uint64, uint64, error) {
	content, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[key] = value * 1024
		}
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	if total == 0 || available > total {
		return 0, 0, errors.New("invalid /proc/meminfo")
	}
	return total - available, total, nil
}

func readDiskUsage(path string) (uint64, uint64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}
	blockSize := uint64(stat.Bsize)
	total := stat.Blocks * blockSize
	available := stat.Bavail * blockSize
	if total == 0 || available > total {
		return 0, 0, errors.New("invalid statfs values")
	}
	return total - available, total, nil
}

func roundMetric(value float64) float64 {
	return math.Round(value*100) / 100
}
