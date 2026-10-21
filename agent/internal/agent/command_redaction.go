package agent

import (
	"encoding/base64"
	"strings"
)

// Managed Git credentials must remain private even when a subprocess echoes
// its authorization header. Inherited tracing can also write them to files.
func gitCommandEnvironment(env []string) ([]string, []string) {
	filtered := make([]string, 0, len(env))
	secrets := []string{}
	for _, item := range env {
		key, value, _ := strings.Cut(item, "=")
		if strings.HasPrefix(key, "GIT_TRACE") || key == "GIT_CURL_VERBOSE" {
			continue
		}
		filtered = append(filtered, item)
		if !strings.HasPrefix(key, "GIT_CONFIG_VALUE_") {
			continue
		}
		prefix, encoded, found := strings.Cut(value, ": ")
		if !found || !strings.EqualFold(prefix, "authorization") || len(encoded) < 6 || !strings.EqualFold(encoded[:6], "basic ") {
			continue
		}
		encoded = encoded[6:]
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		if token, found := strings.CutPrefix(string(decoded), "x-access-token:"); found && token != "" {
			secrets = append(secrets, encoded, token)
		}
	}
	return filtered, secrets
}

func redactCommandOutput(value string, secrets []string) string {
	for _, secret := range secrets {
		value = strings.ReplaceAll(value, secret, "***")
	}
	return redactToken(value)
}

func redactArgs(args []string) []string {
	redacted := make([]string, len(args))
	for index, arg := range args {
		redacted[index] = redactToken(arg)
	}

	return redacted
}

func redactToken(value string) string {
	if !strings.Contains(value, "x-access-token:") {
		return value
	}

	var result strings.Builder
	for {
		prefix, rest, found := strings.Cut(value, "x-access-token:")
		result.WriteString(prefix)
		if !found {
			return result.String()
		}
		result.WriteString("x-access-token:***")
		_, suffix, found := strings.Cut(rest, "@")
		if !found {
			return result.String()
		}
		result.WriteByte('@')
		value = suffix
	}
}
