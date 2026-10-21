package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

func writeEnvFile(path string, envVars []envVar) error {
	lines := []string{}
	for _, envVar := range envVars {
		if strings.TrimSpace(envVar.Key) == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("%s=%s", envVar.Key, quoteEnvValue(envVar.Value)))
	}

	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}

func composeRiskWarnings(path string) []string {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	warnings := []string{}
	lines := strings.Split(string(content), "\n")
	inPorts := false
	inVolumeDefinition := false
	volumeIndent := -1
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		indent := leadingSpaces(line)
		if inPorts && indent <= volumeIndent {
			inPorts = false
		}
		if inVolumeDefinition && indent <= volumeIndent {
			inVolumeDefinition = false
		}

		if strings.HasPrefix(trimmed, "container_name:") {
			warnings = append(warnings, "container_name disables Compose project scoping and can collide across deployments.")
		}
		if strings.HasPrefix(trimmed, "network_mode:") && strings.Contains(trimmed, "host") {
			warnings = append(warnings, "network_mode: host is ignored to preserve Compose network isolation and managed routing.")
		}
		if strings.HasPrefix(trimmed, "privileged:") && strings.Contains(trimmed, "true") {
			warnings = append(warnings, "privileged containers increase host-level risk.")
		}
		if strings.HasPrefix(trimmed, "ports:") {
			inPorts = true
			volumeIndent = indent
			warnings = append(warnings, "published host ports are ignored by devpush managed ingress.")
			continue
		}
		if inPorts && strings.Contains(trimmed, ":") && strings.HasPrefix(trimmed, "-") {
			warnings = append(warnings, "fixed host port mapping detected; devpush will remove it from the deployed Compose model.")
		}
		if strings.HasPrefix(trimmed, "volumes:") {
			inVolumeDefinition = true
			volumeIndent = indent
			continue
		}
		if inVolumeDefinition && strings.HasPrefix(trimmed, "name:") {
			warnings = append(warnings, "explicit volume names are global and may share or collide across runtimes.")
		}
		if inVolumeDefinition && strings.HasPrefix(trimmed, "external:") && strings.Contains(trimmed, "true") {
			warnings = append(warnings, "external volumes or networks are shared by design; ensure that is intentional.")
		}
	}

	return dedupeStrings(warnings)
}

func leadingSpaces(value string) int {
	count := 0
	for _, char := range value {
		if char != ' ' {
			break
		}
		count++
	}

	return count
}

func dedupeStrings(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}

	return result
}

func writeRouteOverride(path string, projectName string, routes []route) error {
	return writeManagedComposeOverride(path, projectName, routes, nil, nil)
}

type resolvedComposeModel struct {
	Services map[string]resolvedComposeService `json:"services"`
}

type resolvedComposeService struct {
	Ports       []json.RawMessage `json:"ports"`
	NetworkMode string            `json:"network_mode"`
	Privileged  bool              `json:"privileged"`
	Volumes     []struct {
		Type   string `json:"type"`
		Source string `json:"source"`
	} `json:"volumes"`
}

func parseComposeModel(value string) (resolvedComposeModel, error) {
	model := resolvedComposeModel{}
	if err := json.Unmarshal([]byte(value), &model); err != nil {
		return resolvedComposeModel{}, err
	}
	if model.Services == nil {
		return resolvedComposeModel{}, fmt.Errorf("resolved configuration has no services")
	}
	return model, nil
}

func (model resolvedComposeModel) riskWarnings() []string {
	warnings := []string{}
	names := []string{}
	for name := range model.Services {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		service := model.Services[name]
		if service.Privileged {
			warnings = append(warnings, fmt.Sprintf("service %s uses privileged containers with host-level access.", name))
		}
		for _, volume := range service.Volumes {
			if volume.Type == "bind" {
				warnings = append(warnings, fmt.Sprintf("service %s bind mounts host path %s; repository deploy access is trusted host access.", name, volume.Source))
			}
		}
	}
	return warnings
}

func (model resolvedComposeModel) servicesWithPublishedPorts() []string {
	services := []string{}
	for name, service := range model.Services {
		if len(service.Ports) > 0 {
			services = append(services, name)
		}
	}
	sort.Strings(services)
	return services
}

func (model resolvedComposeModel) servicesWithHostNetworking() []string {
	services := []string{}
	for name, service := range model.Services {
		if service.NetworkMode == "host" {
			services = append(services, name)
		}
	}
	sort.Strings(services)
	return services
}

func writeManagedComposeOverride(path string, projectName string, routes []route, resetPortServices []string, resetHostNetworkServices []string, managedCertificateNames ...string) error {
	labelsByService := map[string][]string{}
	for index, route := range routes {
		if err := validateRoute(route); err != nil {
			return fmt.Errorf("route %d: %w", index+1, err)
		}

		routerName := sanitizeLabelName(fmt.Sprintf("%s-%s-%d", projectName, route.Service, index+1))
		serviceName := routerName
		labels := []string{
			"traefik.enable=true",
			"traefik.docker.network=devpush-proxy",
			fmt.Sprintf("traefik.http.services.%s.loadbalancer.server.port=%d", serviceName, route.Port),
		}
		routeMiddlewares := []string{}
		if route.StripPrefix && normalizeRoutePath(route.Path) != "/" {
			stripName := routerName + "-strip"
			labels = append(labels, fmt.Sprintf("traefik.http.middlewares.%s.stripprefix.prefixes=%s", stripName, normalizeRoutePath(route.Path)))
			routeMiddlewares = append(routeMiddlewares, stripName)
		}
		if route.HTTPS {
			webRouterName := routerName + "-web"
			secureRouterName := routerName + "-secure"
			redirectName := routerName + "-https"
			webMiddlewares := append([]string{redirectName}, routeMiddlewares...)
			labels = append(
				labels,
				fmt.Sprintf("traefik.http.middlewares.%s.redirectscheme.scheme=https", redirectName),
				fmt.Sprintf("traefik.http.routers.%s.rule=%s", webRouterName, routeRule(route)),
				fmt.Sprintf("traefik.http.routers.%s.entrypoints=web", webRouterName),
				fmt.Sprintf("traefik.http.routers.%s.middlewares=%s", webRouterName, strings.Join(webMiddlewares, ",")),
				fmt.Sprintf("traefik.http.routers.%s.service=%s", webRouterName, serviceName),
				fmt.Sprintf("traefik.http.routers.%s.rule=%s", secureRouterName, routeRule(route)),
				fmt.Sprintf("traefik.http.routers.%s.entrypoints=websecure", secureRouterName),
				fmt.Sprintf("traefik.http.routers.%s.service=%s", secureRouterName, serviceName),
				fmt.Sprintf("traefik.http.routers.%s.tls=true", secureRouterName),
			)
			if !matchesManagedCertificate(route.Host, managedCertificateNames) {
				labels = append(labels, fmt.Sprintf("traefik.http.routers.%s.tls.certresolver=devpush", secureRouterName))
			}
			if len(routeMiddlewares) > 0 {
				labels = append(labels, fmt.Sprintf("traefik.http.routers.%s.middlewares=%s", secureRouterName, strings.Join(routeMiddlewares, ",")))
			}
		} else {
			labels = append(
				labels,
				fmt.Sprintf("traefik.http.routers.%s.rule=%s", routerName, routeRule(route)),
				fmt.Sprintf("traefik.http.routers.%s.entrypoints=web", routerName),
				fmt.Sprintf("traefik.http.routers.%s.service=%s", routerName, serviceName),
			)
			if len(routeMiddlewares) > 0 {
				labels = append(labels, fmt.Sprintf("traefik.http.routers.%s.middlewares=%s", routerName, strings.Join(routeMiddlewares, ",")))
			}
		}
		labelsByService[route.Service] = append(labelsByService[route.Service], labels...)
	}

	resetPorts := map[string]bool{}
	for _, service := range resetPortServices {
		if strings.TrimSpace(service) != "" {
			resetPorts[service] = true
		}
	}
	resetHostNetwork := map[string]bool{}
	for _, service := range resetHostNetworkServices {
		if strings.TrimSpace(service) != "" {
			resetHostNetwork[service] = true
		}
	}

	if len(labelsByService) == 0 && len(resetPorts) == 0 && len(resetHostNetwork) == 0 {
		return os.WriteFile(path, []byte("services: {}\n"), 0o600)
	}

	serviceNames := make([]string, 0, len(labelsByService)+len(resetPorts)+len(resetHostNetwork))
	seenServices := map[string]bool{}
	for service := range labelsByService {
		seenServices[service] = true
		serviceNames = append(serviceNames, service)
	}
	for service := range resetPorts {
		if !seenServices[service] {
			seenServices[service] = true
			serviceNames = append(serviceNames, service)
		}
	}
	for service := range resetHostNetwork {
		if !seenServices[service] {
			seenServices[service] = true
			serviceNames = append(serviceNames, service)
		}
	}
	sort.Strings(serviceNames)

	var builder strings.Builder
	builder.WriteString("services:\n")
	for _, service := range serviceNames {
		labels := labelsByService[service]
		builder.WriteString("  " + yamlKey(service) + ":\n")
		if resetPorts[service] {
			builder.WriteString("    ports: !reset []\n")
		}
		if resetHostNetwork[service] {
			builder.WriteString("    network_mode: !reset null\n")
		}
		if len(labels) > 0 {
			builder.WriteString("    labels:\n")
			for _, label := range labels {
				builder.WriteString("      - " + yamlString(label) + "\n")
			}
			builder.WriteString("    networks:\n")
			builder.WriteString("      - devpush-proxy\n")
		}
	}
	if len(labelsByService) > 0 {
		builder.WriteString("networks:\n")
		builder.WriteString("  devpush-proxy:\n")
		builder.WriteString("    external: true\n")
	}

	return os.WriteFile(path, []byte(builder.String()), 0o600)
}

func validateRoute(route route) error {
	if strings.TrimSpace(route.Host) == "" {
		return fmt.Errorf("host is required")
	}
	if !isValidRouteHost(route.Host) {
		return fmt.Errorf("host must be a valid DNS hostname without protocol, path, wildcard, or port")
	}
	if strings.TrimSpace(route.Service) == "" {
		return fmt.Errorf("service is required")
	}
	for _, char := range route.Service {
		valid := (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '-' ||
			char == '_' ||
			char == '.'
		if !valid {
			return fmt.Errorf("service contains unsupported characters")
		}
	}
	if route.Port < 1 || route.Port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	if route.Path == "" {
		return fmt.Errorf("path is required")
	}
	if !strings.HasPrefix(route.Path, "/") {
		return fmt.Errorf("path must start with /")
	}
	if strings.ContainsAny(route.Path, "` \t\r\n?#") {
		return fmt.Errorf("path contains unsupported whitespace, query, fragment, or backtick character")
	}
	if route.StripPrefix && strings.Contains(route.Path, ",") {
		return fmt.Errorf("comma paths cannot use prefix stripping")
	}

	return nil
}

func isValidRouteHost(host string) bool {
	host = strings.TrimSpace(host)
	if host == "" || len(host) > 253 {
		return false
	}
	if strings.Contains(host, "*") || strings.Contains(host, "/") || strings.Contains(host, "`") {
		return false
	}
	if _, port, err := strings.Cut(host, ":"); err {
		if port == "" {
			return false
		}
		if _, parseErr := strconv.Atoi(port); parseErr == nil {
			return false
		}
		return false
	}

	for _, label := range strings.Split(host, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, char := range label {
			valid := (char >= 'a' && char <= 'z') ||
				(char >= 'A' && char <= 'Z') ||
				(char >= '0' && char <= '9') ||
				char == '-'
			if !valid {
				return false
			}
		}
	}

	return true
}

func routeRule(route route) string {
	rule := fmt.Sprintf("Host(`%s`)", route.Host)
	path := normalizeRoutePath(route.Path)
	if path != "/" {
		rule += fmt.Sprintf(" && PathPrefix(`%s`)", path)
	}

	return rule
}

func routeReadinessPath(routePath string, readinessPath string) string {
	readinessPath = strings.TrimSpace(readinessPath)
	if readinessPath == "" {
		readinessPath = "/"
	}
	if !strings.HasPrefix(readinessPath, "/") {
		readinessPath = "/" + readinessPath
	}

	routePath = normalizeRoutePath(routePath)
	if routePath == "" || routePath == "/" {
		return readinessPath
	}

	if readinessPath == routePath || strings.HasPrefix(readinessPath, routePath+"/") {
		return readinessPath
	}

	return routePath + readinessPath
}

func normalizeRoutePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if path != "/" {
		path = strings.TrimRight(path, "/")
	}
	if path == "" {
		return "/"
	}

	return path
}

func sanitizeLabelName(value string) string {
	value = strings.ToLower(value)
	var builder strings.Builder
	previousDash := false
	for _, char := range value {
		valid := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if valid {
			builder.WriteRune(char)
			previousDash = false
			continue
		}
		if !previousDash {
			builder.WriteRune('-')
			previousDash = true
		}
	}

	return strings.Trim(builder.String(), "-")
}

func yamlKey(value string) string {
	if value == "" {
		return "service"
	}

	return yamlString(value)
}

func yamlString(value string) string {
	// Compose interpolates YAML values even when the scalar is single quoted.
	// Generated labels and mount values represent literal strings.
	return "'" + strings.ReplaceAll(strings.ReplaceAll(value, "$", "$$"), "'", "''") + "'"
}

// Double quoting handles trailing backslashes and backslash-quote combinations.
// Escape dollars for dotenv interpolation; custom commands receive raw values
// through their environment and must not source this Compose env file.
func quoteEnvValue(value string) string {
	escaped := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "$", "$$", "\n", "\\n", "\r", "\\r", "\t", "\\t").Replace(value)
	return "\"" + escaped + "\""
}
