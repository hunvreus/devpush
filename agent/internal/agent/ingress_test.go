package agent

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestManagedIngressRejectsOldImagesAndSettings(t *testing.T) {
	bin := t.TempDir()
	script := `#!/bin/sh
case "$3" in
  '{{.Config.Image}}|{{index .Config.Labels "devpush.ingress-config"}}') printf '%s|%s\n' "$CURRENT_IMAGE" "$CURRENT_FINGERPRINT" ;;
  '{{json .Config.Cmd}}') echo '["--providers.docker.endpoint=tcp://devpush-docker-socket-proxy:2375","--providers.docker.network=devpush-proxy"]' ;;
  '{{json .Mounts}}') echo '[]' ;;
  '{{json .NetworkSettings.Networks}}') echo '{"devpush-docker-api":{},"devpush-proxy":{}}' ;;
  *) exit 1 ;;
esac
`
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+":"+os.Getenv("PATH"))
	original := NewRunner(Config{TraefikEmail: "ops@example.com"}, nil)
	t.Setenv("CURRENT_FINGERPRINT", original.ingressConfigFingerprint())
	for _, tc := range []struct {
		name, image string
		config      Config
		matches     bool
	}{
		{"current", traefikImage, original.cfg, true},
		{"old image", "traefik:old", original.cfg, false},
		{"changed port", traefikImage, Config{TraefikEmail: "ops@example.com", TraefikHTTPPort: 8080}, false},
		{"changed email", traefikImage, Config{TraefikEmail: "new@example.com"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CURRENT_IMAGE", tc.image)
			runner := NewRunner(tc.config, nil)
			got, err := runner.traefikUsesSocketProxy(context.Background())
			if err != nil || got != tc.matches {
				t.Fatalf("configured=%v error=%v", got, err)
			}
		})
	}
}
