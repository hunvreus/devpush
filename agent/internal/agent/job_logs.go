package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const maxJobLogBytes = 10 << 20
const maxJobLogTotalBytes = 100 << 20
const jobLogRetention = 14 * 24 * time.Hour

var jobLogID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

type jobLogContextKey struct{}
type jobLogWriter struct {
	mu        sync.Mutex
	file      *os.File
	size      int64
	secrets   []string
	truncated bool
}

func (writer *jobLogWriter) Write(body []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	length := len(body)
	text := redactToken(string(body))
	for _, secret := range writer.secrets {
		if secret != "" {
			text = strings.ReplaceAll(text, secret, "***")
		}
	}
	if writer.truncated {
		return length, nil
	}
	text = time.Now().UTC().Format(time.RFC3339Nano) + " " + text
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	if writer.size+int64(len(text)) > maxJobLogBytes-128 {
		text = "[Log size limit reached; further diagnostics omitted]\n"
		writer.truncated = true
	}
	n, err := writer.file.WriteString(text)
	writer.size += int64(n)
	if err != nil {
		writer.truncated = true
	}
	return length, nil
}
func writeJobProgress(ctx context.Context, message string) {
	if writer, ok := ctx.Value(jobLogContextKey{}).(*jobLogWriter); ok {
		_, _ = writer.Write([]byte(message))
	}
}
func jobDiagnostics(ctx context.Context, buffer io.Writer) io.Writer {
	if writer, ok := ctx.Value(jobLogContextKey{}).(*jobLogWriter); ok {
		return io.MultiWriter(buffer, writer)
	}
	return buffer
}
func (runner *Runner) beginJobLog(ctx context.Context, job agentJob) (context.Context, func(string, string)) {
	if runner.cfg.StateDir == "" || !jobLogID.MatchString(job.ID) {
		return ctx, func(string, string) {}
	}
	dir := filepath.Join(runner.cfg.StateDir, "logs", "jobs")
	if err := os.MkdirAll(dir, 0700); err != nil {
		runner.log.Warn("create job log directory failed", "error", err)
		return ctx, func(string, string) {}
	}
	pruneJobLogs(dir, time.Now())
	file, err := os.OpenFile(filepath.Join(dir, job.ID+".log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		runner.log.Warn("open job log failed", "error", err)
		return ctx, func(string, string) {}
	}
	info, _ := file.Stat()
	writer := &jobLogWriter{file: file, secrets: []string{runner.currentCredential(), job.Backup.Destination.AccessKeyID, job.Backup.Destination.SecretAccessKey, job.Restore.Destination.AccessKeyID, job.Restore.Destination.SecretAccessKey}}
	if info != nil {
		writer.size = info.Size()
		writer.truncated = writer.size > maxJobLogBytes-128
	}
	ctx = context.WithValue(ctx, jobLogContextKey{}, writer)
	writeJobProgress(ctx, fmt.Sprintf("Starting %s job.", job.Type))
	return ctx, func(status, message string) {
		writeJobProgress(ctx, fmt.Sprintf("%s %s. %s", job.Type, status, message))
		_ = file.Close()
	}
}
func pruneJobLogs(dir string, now time.Time) {
	entries, _ := os.ReadDir(dir)
	type candidate struct {
		path string
		info os.FileInfo
	}
	files := []candidate{}
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		if now.Sub(info.ModTime()) > jobLogRetention {
			_ = os.Remove(path)
			_ = os.Remove(strings.TrimSuffix(path, ".log") + ".offset")
			continue
		}
		total += info.Size()
		files = append(files, candidate{path, info})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].info.ModTime().Before(files[j].info.ModTime()) })
	for _, file := range files {
		if total <= maxJobLogTotalBytes-maxJobLogBytes {
			break
		}
		if os.Remove(file.path) == nil {
			total -= file.info.Size()
			_ = os.Remove(strings.TrimSuffix(file.path, ".log") + ".offset")
		}
	}
}

type jobLogRead struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	JobID     string `json:"jobId"`
	Offset    int64  `json:"offset"`
}

func (runner *Runner) readJobLog(request jobLogRead) map[string]any {
	result := map[string]any{"type": "result", "requestId": request.RequestID, "content": "", "offset": request.Offset}
	if !jobLogID.MatchString(request.JobID) || request.Offset < 0 {
		result["unavailable"] = true
		return result
	}
	file, err := os.Open(filepath.Join(runner.cfg.StateDir, "logs", "jobs", request.JobID+".log"))
	if err != nil {
		result["unavailable"] = true
		return result
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || time.Since(info.ModTime()) > jobLogRetention {
		result["unavailable"] = true
		return result
	}
	if request.Offset > info.Size() {
		request.Offset = 0
		result["reset"] = true
	}
	buffer := make([]byte, 16<<10)
	n, err := file.ReadAt(buffer, request.Offset)
	if err != nil && err != io.EOF {
		result["unavailable"] = true
		return result
	}
	// Avoid splitting a UTF-8 character at the chunk boundary.
	if n == len(buffer) {
		for back := 0; back < 3 && n > 0 && !utf8.Valid(buffer[:n]); back++ {
			n--
		}
	}
	result["content"] = string(buffer[:n])
	result["offset"] = request.Offset + int64(n)
	return result
}

// Host files and acknowledged byte offsets form a bounded durable upload outbox.
// No requests are made when every file has been acknowledged.
func (runner *Runner) runJobLogUploads(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		runner.flushJobLogs(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (runner *Runner) flushJobLogs(ctx context.Context) {
	dir := filepath.Join(runner.cfg.StateDir, "logs", "jobs")
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".log")
		cursorPath := filepath.Join(dir, id+".offset")
		body, _ := os.ReadFile(cursorPath)
		var offset int64
		_ = json.Unmarshal(body, &offset)
		for {
			result := runner.readJobLog(jobLogRead{JobID: id, Offset: offset})
			content, _ := result["content"].(string)
			if content == "" || result["reset"] == true {
				break
			}
			next := result["offset"].(int64)
			request := map[string]any{"serverId": runner.cfg.AgentID, "token": runner.currentCredential(), "jobId": id, "offset": offset, "content": content}
			var response struct {
				OK bool `json:"ok"`
			}
			uploadCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := runner.post(uploadCtx, "/api/agents/job-logs", request, &response)
			cancel()
			if err != nil || !response.OK {
				break
			}
			cursor, _ := json.Marshal(next)
			if err := os.WriteFile(cursorPath, cursor, 0600); err != nil {
				break
			}
			offset = next
		}
	}
}
