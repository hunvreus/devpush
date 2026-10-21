// Workers does not implement dns.lookup / a pinned HTTPS lookup boundary.
// Keep OAuth dynamic registration available; do not advertise unsupported CIMD
// or fall back to fetch(), which cannot prevent DNS rebinding here.
export function oauthDiscoveryPlugins() {
  return []
}
