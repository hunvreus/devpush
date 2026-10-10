package agent

import "strings"

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

	prefix, rest, ok := strings.Cut(value, "x-access-token:")
	if !ok {
		return value
	}
	_, suffix, ok := strings.Cut(rest, "@")
	if !ok {
		return prefix + "x-access-token:***"
	}

	return prefix + "x-access-token:***@" + suffix
}
