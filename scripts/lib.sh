#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${DEVPUSH_DATA_DIR:-$APP_DIR/data}"
ENV_FILE="${DEVPUSH_ENV_FILE:-$DATA_DIR/.env}"
CHART_DIR="$APP_DIR/helm/devpush"

NAMESPACE="${DEVPUSH_NAMESPACE:-devpush}"
RELEASE_NAME="${DEVPUSH_RELEASE_NAME:-devpush}"
KUBE_CONTEXT="${DEVPUSH_KUBE_CONTEXT:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  }
}

ensure_k3d_cluster() {
  require_cmd k3d
  require_cmd docker
  local cluster_name="devpush"
  local node_name="k3d-${cluster_name}-server-0"

  if ! k3d cluster list 2>/dev/null | grep '^devpush[[:space:]]' >/dev/null 2>&1; then
    printf "Creating k3d cluster 'devpush'...\n"
    k3d cluster create "$cluster_name" \
      -p "80:80@loadbalancer" \
      --volume "$APP_DIR:$APP_DIR@all"
  fi

  if ! docker inspect "$node_name" --format '{{range .Mounts}}{{println .Source}}{{end}}' 2>/dev/null | grep -Fx "$APP_DIR" >/dev/null 2>&1; then
    printf "k3d cluster '%s' is missing required source mount: %s\n" "$cluster_name" "$APP_DIR" >&2
    printf "Recreate it with:\n" >&2
    printf "  k3d cluster delete %s\n" "$cluster_name" >&2
    printf "  k3d cluster create %s -p \"80:80@loadbalancer\" --volume \"%s:%s@all\"\n" "$cluster_name" "$APP_DIR" "$APP_DIR" >&2
    exit 1
  fi

  kubectl config use-context "k3d-${cluster_name}" >/dev/null
}

ensure_kube_api() {
  kubectl cluster-info --request-timeout=20s >/dev/null
}

get_kube_context() {
  kubectl config current-context 2>/dev/null || true
}

get_kube_provider() {
  local context
  context="$(get_kube_context)"
  if [[ "$context" == k3d-* ]]; then
    printf "k3d\n"
    return
  fi
  if [[ "$context" == "colima" ]]; then
    printf "colima\n"
    return
  fi
  printf "unknown\n"
}

get_k3d_cluster_name() {
  local context
  context="$(get_kube_context)"
  if [[ "$context" == k3d-* ]]; then
    printf "%s\n" "${context#k3d-}"
    return
  fi
  printf "\n"
}

select_context() {
  if [[ -n "$KUBE_CONTEXT" ]]; then
    kubectl config use-context "$KUBE_CONTEXT" >/dev/null
    return
  fi

  if kubectl config get-contexts -o name 2>/dev/null | grep -x "k3d-devpush" >/dev/null 2>&1; then
    kubectl config use-context k3d-devpush >/dev/null
    return
  fi

  k3d_context="$(kubectl config get-contexts -o name 2>/dev/null | grep '^k3d-' | head -n1 || true)"
  if [[ -n "$k3d_context" ]]; then
    kubectl config use-context "$k3d_context" >/dev/null
    return
  fi

  if command -v k3d >/dev/null 2>&1; then
    ensure_k3d_cluster
    return
  fi

  printf "No k3d context found and k3d is not installed.\n" >&2
  printf "Install k3d, then re-run start:\n" >&2
  printf "  brew install k3d\n" >&2
  exit 1
}

print_access_urls() {
  local provider
  provider="$(get_kube_provider)"

  if [[ "$provider" == "k3d" ]]; then
    printf "Kubernetes provider: k3d\n"
    printf "App URL: http://localhost\n"
    return
  fi

  service_type="$(kubectl -n "$NAMESPACE" get svc traefik -o jsonpath='{.spec.type}')"
  case "$service_type" in
    NodePort)
      traefik_node_port="$(kubectl -n "$NAMESPACE" get svc traefik -o jsonpath='{.spec.ports[?(@.name==\"web\")].nodePort}')"
      traefik_node_ip="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type==\"InternalIP\")].address}')"
      printf "Traefik service type: NodePort\n"
      printf "App URL (host): http://localhost:%s\n" "$traefik_node_port"
      printf "App URL (node): http://%s:%s\n" "$traefik_node_ip" "$traefik_node_port"
      ;;
    LoadBalancer)
      lb_hostname="$(kubectl -n "$NAMESPACE" get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)"
      lb_ip="$(kubectl -n "$NAMESPACE" get svc traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
      printf "Traefik service type: LoadBalancer\n"
      if [[ -n "$lb_hostname" ]]; then
        printf "App URL: http://%s\n" "$lb_hostname"
      elif [[ -n "$lb_ip" ]]; then
        printf "App URL: http://%s\n" "$lb_ip"
      else
        printf "LoadBalancer ingress is pending.\n"
      fi
      ;;
    ClusterIP)
      host_port="$(kubectl -n "$NAMESPACE" get deployment "${RELEASE_NAME}-traefik" -o jsonpath='{.spec.template.spec.containers[0].ports[?(@.name==\"web\")].hostPort}' 2>/dev/null || true)"
      printf "Traefik service type: ClusterIP\n"
      if [[ -n "$host_port" ]]; then
        traefik_node_ip="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type==\"InternalIP\")].address}')"
        printf "App URL (host): http://localhost:%s\n" "$host_port"
        printf "App URL (node): http://%s:%s\n" "$traefik_node_ip" "$host_port"
      else
        printf "No host-exposed URL detected.\n"
      fi
      ;;
    *)
      printf "Traefik service type: %s\n" "$service_type"
      ;;
  esac
}
