#!/usr/bin/env bash
set -euo pipefail

ZONEPLOY_REPO_URL="${ZONEPLOY_REPO_URL:-https://github.com/zoneploy/zoneploy.git}"
ZONEPLOY_INSTALL_REF="${ZONEPLOY_INSTALL_REF:-development}"
ZONEPLOY_HOME="${ZONEPLOY_HOME:-/opt/zoneploy}"
ZONEPLOY_SOURCE_DIR="${ZONEPLOY_SOURCE_DIR:-${ZONEPLOY_HOME}/source}"
ZONEPLOY_CONFIG_DIR="${ZONEPLOY_CONFIG_DIR:-/etc/zoneploy/config}"
ZONEPLOY_DATA_DIR="${ZONEPLOY_DATA_DIR:-/var/lib/zoneploy}"
ZONEPLOY_LOG_DIR="${ZONEPLOY_LOG_DIR:-/var/log/zoneploy}"
ZONEPLOY_AGENT_PORT="${ZONEPLOY_AGENT_PORT:-4000}"
ZONEPLOY_AGENT_API_TOKEN="${ZONEPLOY_AGENT_API_TOKEN:-}"
ZONEPLOY_ROUTES_DIR="${ZONEPLOY_ROUTES_DIR:-/etc/zoneploy/runtime-routes}"
ZONEPLOY_REGISTRY_HOST="${ZONEPLOY_REGISTRY_HOST:-127.0.0.1}"
ZONEPLOY_REGISTRY_PORT="${ZONEPLOY_REGISTRY_PORT:-5000}"
ZONEPLOY_REGISTRY_DIR="${ZONEPLOY_REGISTRY_DIR:-${ZONEPLOY_DATA_DIR}/registry}"
ZONEPLOY_REGISTRY_CONFIG_FILE="${ZONEPLOY_REGISTRY_CONFIG_FILE:-${ZONEPLOY_CONFIG_DIR}/registry.yml}"
ZONEPLOY_BUILDS_DIR="${ZONEPLOY_BUILDS_DIR:-${ZONEPLOY_DATA_DIR}/builds}"
ZONEPLOY_RELEASES_DIR="${ZONEPLOY_RELEASES_DIR:-${ZONEPLOY_DATA_DIR}/releases}"
ZONEPLOY_DEPLOYMENTS_DIR="${ZONEPLOY_DEPLOYMENTS_DIR:-${ZONEPLOY_DATA_DIR}/deployments}"
ZONEPLOY_APPS_DIR="${ZONEPLOY_APPS_DIR:-${ZONEPLOY_DATA_DIR}/apps}"
ZONEPLOY_CLEANUP_ENABLED="${ZONEPLOY_CLEANUP_ENABLED:-true}"
ZONEPLOY_CLEANUP_KEEP_RELEASES="${ZONEPLOY_CLEANUP_KEEP_RELEASES:-5}"
ZONEPLOY_CLEANUP_KEEP_DAYS="${ZONEPLOY_CLEANUP_KEEP_DAYS:-14}"
ZONEPLOY_CLEANUP_MAX_REGISTRY_GB="${ZONEPLOY_CLEANUP_MAX_REGISTRY_GB:-20}"
ZONEPLOY_TRAEFIK_ENABLED="${ZONEPLOY_TRAEFIK_ENABLED:-true}"
ZONEPLOY_TRAEFIK_HTTP_PORT="${ZONEPLOY_TRAEFIK_HTTP_PORT:-80}"
ZONEPLOY_TRAEFIK_HTTPS_PORT="${ZONEPLOY_TRAEFIK_HTTPS_PORT:-443}"
ZONEPLOY_TRAEFIK_DIR="${ZONEPLOY_TRAEFIK_DIR:-/etc/zoneploy/traefik}"
ZONEPLOY_TRAEFIK_DYNAMIC_DIR="${ZONEPLOY_TRAEFIK_DYNAMIC_DIR:-${ZONEPLOY_TRAEFIK_DIR}/dynamic}"
ZONEPLOY_PROFILE="${ZONEPLOY_PROFILE:-standalone}"
ZONEPLOY_WEB_PORT="${ZONEPLOY_WEB_PORT:-8080}"
POSTGRES_DB="${POSTGRES_DB:-zoneploy}"
POSTGRES_USER="${POSTGRES_USER:-zoneploy}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-}"
APP_URL_WAS_PROVIDED="${APP_URL+x}"
APP_URL="${APP_URL:-http://localhost:${ZONEPLOY_WEB_PORT}}"
ROUTING_DOMAIN="${ROUTING_DOMAIN:-localhost}"
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASS="${SMTP_PASS:-}"
SMTP_FROM="${SMTP_FROM:-Zoneploy <no-reply@localhost>}"
ZONEPLOY_SKIP_DOCKER="${ZONEPLOY_SKIP_DOCKER:-false}"

ACTION="install"
PURGE_DATA="false"
SERVICE_NAME="zoneploy-agent"
ENV_FILE="${ZONEPLOY_CONFIG_DIR}/agent.env"
STACK_ENV_FILE="${ZONEPLOY_CONFIG_DIR}/selfhost.env"
PNPM_VERSION="9.15.0"
PACKAGE_MANAGER="unknown"
PACKAGE_CACHE_UPDATED="false"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok() { printf '%b[ok]%b %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%b[warn]%b %s\n' "$YELLOW" "$NC" "$*"; }
fail() { printf '%b[error]%b %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
Zoneploy self-hosted installer

Usage:
  curl -sSL https://zoneploy.com/install.sh | bash
  bash install.sh install [options]
  bash install.sh update [options]
  bash install.sh repair [options]
  bash install.sh uninstall [--purge]

Commands:
  install                  Install or reinstall Zoneploy. Default command.
  update                   Fetch the configured ref, rebuild and restart the agent.
  repair                   Rebuild local source and rewrite service/shims without changing ref.
  uninstall                Remove service, command shims and source. Keeps config/data by default.

Options:
  --agent-port <port>       Agent HTTP port. Default: 4000
  --web-port <port>         Local dashboard HTTP port. Default: 8080
  --registry-port <port>    Local registry port. Default: 5000
  --http-port <port>        Local Traefik HTTP port. Default: 80
  --https-port <port>       Local Traefik HTTPS port. Default: 443
  --ref <git-ref>           Git ref to install. Default: development
  --repo <url>              Git repository URL. Default: https://github.com/zoneploy/zoneploy.git
  --skip-docker             Do not install or start Docker
  --skip-traefik            Do not start the local Traefik edge
  --purge                   With uninstall, also remove config, data and logs
  --help                    Show this help

Environment variables with the ZONEPLOY_ prefix can also be used.
USAGE
}

case "${1:-}" in
  install|update|repair|uninstall)
    ACTION="$1"
    shift
    ;;
esac

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent-port)
      ZONEPLOY_AGENT_PORT="${2:?--agent-port requires a value}"
      shift 2
      ;;
    --web-port)
      ZONEPLOY_WEB_PORT="${2:?--web-port requires a value}"
      if [ -z "$APP_URL_WAS_PROVIDED" ]; then
        APP_URL="http://localhost:${ZONEPLOY_WEB_PORT}"
      fi
      shift 2
      ;;
    --ref)
      ZONEPLOY_INSTALL_REF="${2:?--ref requires a value}"
      shift 2
      ;;
    --registry-port)
      ZONEPLOY_REGISTRY_PORT="${2:?--registry-port requires a value}"
      shift 2
      ;;
    --http-port)
      ZONEPLOY_TRAEFIK_HTTP_PORT="${2:?--http-port requires a value}"
      shift 2
      ;;
    --https-port)
      ZONEPLOY_TRAEFIK_HTTPS_PORT="${2:?--https-port requires a value}"
      shift 2
      ;;
    --repo)
      ZONEPLOY_REPO_URL="${2:?--repo requires a value}"
      shift 2
      ;;
    --skip-docker)
      ZONEPLOY_SKIP_DOCKER="true"
      shift
      ;;
    --skip-traefik)
      ZONEPLOY_TRAEFIK_ENABLED="false"
      shift
      ;;
    --purge)
      PURGE_DATA="true"
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

detect_package_manager() {
  if command_exists apt-get; then
    printf 'apt'
    return
  fi
  if command_exists dnf; then
    printf 'dnf'
    return
  fi
  if command_exists yum; then
    printf 'yum'
    return
  fi
  if command_exists apk; then
    printf 'apk'
    return
  fi
  printf 'unknown'
}

refresh_package_cache() {
  if [ "$PACKAGE_CACHE_UPDATED" = "true" ]; then
    return
  fi

  case "$PACKAGE_MANAGER" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get update
      ;;
    dnf)
      dnf makecache -y >/dev/null 2>&1 || true
      ;;
    yum)
      yum makecache -y >/dev/null 2>&1 || true
      ;;
    apk)
      apk update
      ;;
  esac

  PACKAGE_CACHE_UPDATED="true"
}

install_packages() {
  if [ "$#" -eq 0 ]; then
    return
  fi

  refresh_package_cache

  case "$PACKAGE_MANAGER" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
      ;;
    dnf)
      dnf install -y --allowerasing "$@"
      ;;
    yum)
      yum install -y "$@"
      ;;
    apk)
      apk add --no-cache "$@"
      ;;
  esac
}

require_supported_host() {
  [ "$(uname -s 2>/dev/null || true)" = "Linux" ] || fail "Zoneploy can only be installed on Linux."
  [ "$(id -u)" -eq 0 ] || fail "Run this installer as root."
  command_exists systemctl || fail "systemd is required."
  [ -d /run/systemd/system ] || fail "systemd must be running as the host init system."

  PACKAGE_MANAGER="$(detect_package_manager)"
  if [ "$ACTION" = "uninstall" ]; then
    return
  fi

  case "$PACKAGE_MANAGER" in
    apt|dnf|yum|apk) ;;
    *) fail "Unsupported package manager. Supported: apt, dnf, yum, apk." ;;
  esac

  case "$ZONEPLOY_PROFILE" in
    standalone) ;;
    *) fail "ZONEPLOY_PROFILE must be standalone." ;;
  esac

  case "$ZONEPLOY_AGENT_PORT" in
    ''|*[!0-9]*) fail "ZONEPLOY_AGENT_PORT must be a TCP port number." ;;
  esac

  [ "$ZONEPLOY_AGENT_PORT" -ge 1 ] && [ "$ZONEPLOY_AGENT_PORT" -le 65535 ] \
    || fail "ZONEPLOY_AGENT_PORT must be between 1 and 65535."

  case "$ZONEPLOY_WEB_PORT" in
    ''|*[!0-9]*) fail "ZONEPLOY_WEB_PORT must be a TCP port number." ;;
  esac

  [ "$ZONEPLOY_WEB_PORT" -ge 1 ] && [ "$ZONEPLOY_WEB_PORT" -le 65535 ] \
    || fail "ZONEPLOY_WEB_PORT must be between 1 and 65535."

  case "$ZONEPLOY_REGISTRY_PORT" in
    ''|*[!0-9]*) fail "ZONEPLOY_REGISTRY_PORT must be a TCP port number." ;;
  esac

  [ "$ZONEPLOY_REGISTRY_PORT" -ge 1 ] && [ "$ZONEPLOY_REGISTRY_PORT" -le 65535 ] \
    || fail "ZONEPLOY_REGISTRY_PORT must be between 1 and 65535."

  if [ "$ZONEPLOY_REGISTRY_PORT" = "$ZONEPLOY_AGENT_PORT" ]; then
    fail "ZONEPLOY_REGISTRY_PORT must be different from ZONEPLOY_AGENT_PORT."
  fi

  case "$ZONEPLOY_TRAEFIK_HTTP_PORT" in
    ''|*[!0-9]*) fail "ZONEPLOY_TRAEFIK_HTTP_PORT must be a TCP port number." ;;
  esac

  [ "$ZONEPLOY_TRAEFIK_HTTP_PORT" -ge 1 ] && [ "$ZONEPLOY_TRAEFIK_HTTP_PORT" -le 65535 ] \
    || fail "ZONEPLOY_TRAEFIK_HTTP_PORT must be between 1 and 65535."

  case "$ZONEPLOY_TRAEFIK_HTTPS_PORT" in
    ''|*[!0-9]*) fail "ZONEPLOY_TRAEFIK_HTTPS_PORT must be a TCP port number." ;;
  esac

  [ "$ZONEPLOY_TRAEFIK_HTTPS_PORT" -ge 1 ] && [ "$ZONEPLOY_TRAEFIK_HTTPS_PORT" -le 65535 ] \
    || fail "ZONEPLOY_TRAEFIK_HTTPS_PORT must be between 1 and 65535."

  if [ "$ZONEPLOY_TRAEFIK_HTTP_PORT" = "$ZONEPLOY_AGENT_PORT" ] \
    || [ "$ZONEPLOY_TRAEFIK_HTTP_PORT" = "$ZONEPLOY_REGISTRY_PORT" ] \
    || [ "$ZONEPLOY_TRAEFIK_HTTP_PORT" = "$ZONEPLOY_WEB_PORT" ]; then
    fail "ZONEPLOY_TRAEFIK_HTTP_PORT must be different from agent, web and registry ports."
  fi

  if [ "$ZONEPLOY_TRAEFIK_HTTPS_PORT" = "$ZONEPLOY_AGENT_PORT" ] \
    || [ "$ZONEPLOY_TRAEFIK_HTTPS_PORT" = "$ZONEPLOY_REGISTRY_PORT" ] \
    || [ "$ZONEPLOY_TRAEFIK_HTTPS_PORT" = "$ZONEPLOY_WEB_PORT" ] \
    || [ "$ZONEPLOY_TRAEFIK_HTTPS_PORT" = "$ZONEPLOY_TRAEFIK_HTTP_PORT" ]; then
    fail "ZONEPLOY_TRAEFIK_HTTPS_PORT must be different from agent, web, registry and HTTP ports."
  fi

}

install_base_packages() {
  case "$PACKAGE_MANAGER" in
    apt)
      install_packages ca-certificates curl git bash gnupg iproute2 iptables procps sed grep gawk
      ;;
    dnf|yum)
      install_packages ca-certificates curl git bash iproute iptables procps-ng sed grep gawk findutils
      ;;
    apk)
      install_packages ca-certificates curl git bash iproute2 iptables procps sed grep gawk
      ;;
  esac

  command_exists update-ca-certificates && update-ca-certificates >/dev/null 2>&1 || true
}

node_major() {
  node -e 'const version = process.versions.node.split(".")[0]; process.stdout.write(version)' 2>/dev/null || printf '0'
}

install_nodejs() {
  local major
  major="$(node_major)"

  if [ "$major" -ge 20 ] 2>/dev/null; then
    ok "Node.js $(node --version) already installed"
    return
  fi

  echo "Installing Node.js 20..."
  case "$PACKAGE_MANAGER" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/zoneploy-nodesource.sh
      bash /tmp/zoneploy-nodesource.sh
      PACKAGE_CACHE_UPDATED="true"
      install_packages nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x -o /tmp/zoneploy-nodesource.sh
      bash /tmp/zoneploy-nodesource.sh
      install_packages nodejs
      ;;
    apk)
      install_packages nodejs npm
      ;;
  esac

  [ "$(node_major)" -ge 20 ] 2>/dev/null || fail "Node.js 20 or newer is required."
}

install_pnpm() {
  if command_exists corepack; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null 2>&1 || true
  fi

  if ! command_exists pnpm; then
    npm install -g "pnpm@${PNPM_VERSION}" --silent
  fi

  command_exists pnpm || fail "pnpm could not be installed."
  ok "pnpm $(pnpm --version)"
}

is_docker_snap_install() {
  if command_exists docker; then
    local docker_path
    docker_path="$(command -v docker || true)"
    if printf '%s' "$docker_path" | grep -q '^/snap/'; then
      return 0
    fi
  fi

  if command_exists snap && snap list docker >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

enable_and_start_service() {
  local service="$1"
  systemctl enable "$service" >/dev/null 2>&1 || true
  systemctl start "$service" >/dev/null 2>&1 || true
}

install_compose_plugin() {
  if docker compose version >/dev/null 2>&1; then
    ok "Docker Compose $(docker compose version --short 2>/dev/null || docker compose version)"
    return
  fi

  case "$PACKAGE_MANAGER" in
    apt)
      install_packages docker-compose-plugin || true
      ;;
    dnf|yum)
      install_packages docker-compose-plugin || true
      ;;
    apk)
      install_packages docker-cli-compose || true
      ;;
  esac

  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required."
}

install_docker() {
  if [ "$ZONEPLOY_SKIP_DOCKER" = "true" ]; then
    warn "Skipping Docker installation by request."
    return
  fi

  if is_docker_snap_install; then
    fail "Docker is installed through Snap. Remove it first with: snap remove docker"
  fi

  if ! command_exists docker; then
    echo "Installing Docker..."
    if [ "$PACKAGE_MANAGER" = "apk" ]; then
      install_packages docker docker-cli-compose
    else
      curl -fsSL https://get.docker.com -o /tmp/zoneploy-get-docker.sh
      sh /tmp/zoneploy-get-docker.sh
    fi
  fi

  enable_and_start_service docker
  sleep 2
  docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is not reachable."
  install_compose_plugin
  docker network create zoneploy >/dev/null 2>&1 || true
  ok "Docker is ready"
}

checkout_source() {
  install -d -m 0755 "$ZONEPLOY_HOME"

  if [ -d "${ZONEPLOY_SOURCE_DIR}/.git" ]; then
    echo "Updating Zoneploy source..."
    git -C "$ZONEPLOY_SOURCE_DIR" fetch --depth 1 origin "$ZONEPLOY_INSTALL_REF"
    git -C "$ZONEPLOY_SOURCE_DIR" checkout -f FETCH_HEAD
  else
    echo "Cloning Zoneploy source..."
    rm -rf "${ZONEPLOY_SOURCE_DIR}.tmp"
    git clone --depth 1 --branch "$ZONEPLOY_INSTALL_REF" "$ZONEPLOY_REPO_URL" "${ZONEPLOY_SOURCE_DIR}.tmp"
    rm -rf "$ZONEPLOY_SOURCE_DIR"
    mv "${ZONEPLOY_SOURCE_DIR}.tmp" "$ZONEPLOY_SOURCE_DIR"
  fi
}

prepare_source() {
  if [ "$ACTION" = "repair" ] && [ -d "${ZONEPLOY_SOURCE_DIR}/.git" ]; then
    ok "Using existing Zoneploy source at ${ZONEPLOY_SOURCE_DIR}"
    return
  fi

  checkout_source
}

build_source() {
  echo "Building Zoneploy..."
  cd "$ZONEPLOY_SOURCE_DIR"
  CI=true NODE_ENV=development PNPM_CONFIG_PROD=false pnpm install --frozen-lockfile --prod=false
  CI=true NODE_ENV=development PNPM_CONFIG_PROD=false pnpm build
}

shell_quote() {
  local value="${1:-}"
  value="${value//\'/\'\"\'\"\'}"
  printf "'%s'" "$value"
}

generate_secret() {
  if command_exists openssl; then
    openssl rand -hex 32
    return
  fi

  if [ -r /dev/urandom ] && command_exists od; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi

  fail "Could not generate a secure agent API token. Install openssl and retry."
}

generate_32_char_secret() {
  if command_exists openssl; then
    openssl rand -hex 16
    return
  fi

  if [ -r /dev/urandom ] && command_exists od; then
    od -An -N16 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi

  fail "Could not generate a secure encryption key. Install openssl and retry."
}

load_existing_config() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi

  if [ -f "$STACK_ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$STACK_ENV_FILE"
    set +a
  fi
}

ensure_runtime_secrets() {
  if [ -z "$ZONEPLOY_AGENT_API_TOKEN" ]; then
    ZONEPLOY_AGENT_API_TOKEN="$(generate_secret)"
  fi

  if [ -z "$POSTGRES_PASSWORD" ]; then
    POSTGRES_PASSWORD="$(generate_secret)"
  fi

  if [ -z "$JWT_ACCESS_SECRET" ]; then
    JWT_ACCESS_SECRET="$(generate_secret)"
  fi

  if [ -z "$JWT_REFRESH_SECRET" ]; then
    JWT_REFRESH_SECRET="$(generate_secret)"
  fi

  if [ -z "$ENCRYPTION_KEY" ]; then
    ENCRYPTION_KEY="$(generate_32_char_secret)"
  fi
}

ensure_agent_api_token() {
  if [ -n "$ZONEPLOY_AGENT_API_TOKEN" ]; then
    return
  fi

  ZONEPLOY_AGENT_API_TOKEN="$(generate_secret)"
}

write_env_file() {
  ensure_agent_api_token

  install -d -m 0755 "$ZONEPLOY_CONFIG_DIR" "$ZONEPLOY_DATA_DIR" "$ZONEPLOY_LOG_DIR" \
    "$ZONEPLOY_ROUTES_DIR" "$ZONEPLOY_REGISTRY_DIR" "$ZONEPLOY_BUILDS_DIR" \
    "$ZONEPLOY_RELEASES_DIR" "$ZONEPLOY_DEPLOYMENTS_DIR" "$ZONEPLOY_APPS_DIR" \
    "$ZONEPLOY_TRAEFIK_DIR" "$ZONEPLOY_TRAEFIK_DYNAMIC_DIR"
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
ZONEPLOY_PROFILE=$(shell_quote "$ZONEPLOY_PROFILE")
ZONEPLOY_AGENT_PORT=$(shell_quote "$ZONEPLOY_AGENT_PORT")
ZONEPLOY_AGENT_API_TOKEN=$(shell_quote "$ZONEPLOY_AGENT_API_TOKEN")
ZONEPLOY_REGISTRY_HOST=$(shell_quote "$ZONEPLOY_REGISTRY_HOST")
ZONEPLOY_REGISTRY_PORT=$(shell_quote "$ZONEPLOY_REGISTRY_PORT")
ZONEPLOY_HOME=$(shell_quote "$ZONEPLOY_HOME")
ZONEPLOY_SOURCE_DIR=$(shell_quote "$ZONEPLOY_SOURCE_DIR")
ZONEPLOY_CONFIG_DIR=$(shell_quote "$ZONEPLOY_CONFIG_DIR")
ZONEPLOY_DATA_DIR=$(shell_quote "$ZONEPLOY_DATA_DIR")
ZONEPLOY_LOG_DIR=$(shell_quote "$ZONEPLOY_LOG_DIR")
ZONEPLOY_ROUTES_DIR=$(shell_quote "$ZONEPLOY_ROUTES_DIR")
ZONEPLOY_REGISTRY_DIR=$(shell_quote "$ZONEPLOY_REGISTRY_DIR")
ZONEPLOY_REGISTRY_CONFIG_FILE=$(shell_quote "$ZONEPLOY_REGISTRY_CONFIG_FILE")
ZONEPLOY_BUILDS_DIR=$(shell_quote "$ZONEPLOY_BUILDS_DIR")
ZONEPLOY_RELEASES_DIR=$(shell_quote "$ZONEPLOY_RELEASES_DIR")
ZONEPLOY_DEPLOYMENTS_DIR=$(shell_quote "$ZONEPLOY_DEPLOYMENTS_DIR")
ZONEPLOY_APPS_DIR=$(shell_quote "$ZONEPLOY_APPS_DIR")
ZONEPLOY_TRAEFIK_ENABLED=$(shell_quote "$ZONEPLOY_TRAEFIK_ENABLED")
ZONEPLOY_TRAEFIK_HTTP_PORT=$(shell_quote "$ZONEPLOY_TRAEFIK_HTTP_PORT")
ZONEPLOY_TRAEFIK_HTTPS_PORT=$(shell_quote "$ZONEPLOY_TRAEFIK_HTTPS_PORT")
ZONEPLOY_TRAEFIK_DIR=$(shell_quote "$ZONEPLOY_TRAEFIK_DIR")
ZONEPLOY_TRAEFIK_DYNAMIC_DIR=$(shell_quote "$ZONEPLOY_TRAEFIK_DYNAMIC_DIR")
ZONEPLOY_CLEANUP_ENABLED=$(shell_quote "$ZONEPLOY_CLEANUP_ENABLED")
ZONEPLOY_CLEANUP_KEEP_RELEASES=$(shell_quote "$ZONEPLOY_CLEANUP_KEEP_RELEASES")
ZONEPLOY_CLEANUP_KEEP_DAYS=$(shell_quote "$ZONEPLOY_CLEANUP_KEEP_DAYS")
ZONEPLOY_CLEANUP_MAX_REGISTRY_GB=$(shell_quote "$ZONEPLOY_CLEANUP_MAX_REGISTRY_GB")
ENV
  chmod 600 "$ENV_FILE"
  ok "Wrote $ENV_FILE"
}

write_stack_env_file() {
  install -d -m 0700 "$ZONEPLOY_CONFIG_DIR"
  umask 077
  cat > "$STACK_ENV_FILE" <<ENV
POSTGRES_DB=$(shell_quote "$POSTGRES_DB")
POSTGRES_USER=$(shell_quote "$POSTGRES_USER")
POSTGRES_PASSWORD=$(shell_quote "$POSTGRES_PASSWORD")
JWT_ACCESS_SECRET=$(shell_quote "$JWT_ACCESS_SECRET")
JWT_REFRESH_SECRET=$(shell_quote "$JWT_REFRESH_SECRET")
ENCRYPTION_KEY=$(shell_quote "$ENCRYPTION_KEY")
ZONEPLOY_AGENT_API_TOKEN=$(shell_quote "$ZONEPLOY_AGENT_API_TOKEN")
LOCAL_AGENT_HOST='host.docker.internal'
LOCAL_AGENT_PORT=$(shell_quote "$ZONEPLOY_AGENT_PORT")
APP_URL=$(shell_quote "$APP_URL")
ROUTING_DOMAIN=$(shell_quote "$ROUTING_DOMAIN")
WEB_PORT=$(shell_quote "$ZONEPLOY_WEB_PORT")
REGISTRY_PORT=$(shell_quote "$ZONEPLOY_REGISTRY_PORT")
TRAEFIK_HTTP_PORT=$(shell_quote "$ZONEPLOY_TRAEFIK_HTTP_PORT")
TRAEFIK_HTTPS_PORT=$(shell_quote "$ZONEPLOY_TRAEFIK_HTTPS_PORT")
SMTP_HOST=$(shell_quote "$SMTP_HOST")
SMTP_PORT=$(shell_quote "$SMTP_PORT")
SMTP_USER=$(shell_quote "$SMTP_USER")
SMTP_PASS=$(shell_quote "$SMTP_PASS")
SMTP_FROM=$(shell_quote "$SMTP_FROM")
ENV
  chmod 600 "$STACK_ENV_FILE"
  ok "Wrote $STACK_ENV_FILE"
}

write_command_shims() {
  cat > /usr/local/bin/zoneploy-agent <<SHIM
#!/usr/bin/env sh
set -a
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a
exec node "$ZONEPLOY_SOURCE_DIR/apps/agent/dist/index.js" "\$@"
SHIM

  cat > /usr/local/bin/zoneploy-agent-update <<SHIM
#!/usr/bin/env sh
set -eu
set -a
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a
unset NODE_ENV
export PNPM_CONFIG_PROD=false
tmp="\$(mktemp /tmp/zoneploy-install.XXXXXX)"
cp "$ZONEPLOY_SOURCE_DIR/install.sh" "\$tmp"
set +e
bash "\$tmp" update "\$@"
status="\$?"
set -e
rm -f "\$tmp"
exit "\$status"
SHIM

  cat > /usr/local/bin/zoneploy-agent-repair <<SHIM
#!/usr/bin/env sh
set -eu
set -a
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a
unset NODE_ENV
export PNPM_CONFIG_PROD=false
tmp="\$(mktemp /tmp/zoneploy-install.XXXXXX)"
cp "$ZONEPLOY_SOURCE_DIR/install.sh" "\$tmp"
set +e
bash "\$tmp" repair "\$@"
status="\$?"
set -e
rm -f "\$tmp"
exit "\$status"
SHIM

  cat > /usr/local/bin/zoneploy-agent-uninstall <<SHIM
#!/usr/bin/env sh
set -eu
set -a
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
set +a
unset NODE_ENV
export PNPM_CONFIG_PROD=false
tmp="\$(mktemp /tmp/zoneploy-install.XXXXXX)"
cp "$ZONEPLOY_SOURCE_DIR/install.sh" "\$tmp"
set +e
bash "\$tmp" uninstall "\$@"
status="\$?"
set -e
rm -f "\$tmp"
exit "\$status"
SHIM

  cat > /usr/local/bin/zoneploy-agent-status <<'SHIM'
#!/usr/bin/env sh
exec zoneploy-agent status "$@"
SHIM

  cat > /usr/local/bin/zoneploy-agent-debug <<'SHIM'
#!/usr/bin/env sh
exec zoneploy-agent debug "$@"
SHIM

  cat > /usr/local/bin/zoneploy-agent-audit <<'SHIM'
#!/usr/bin/env sh
exec zoneploy-agent audit "$@"
SHIM

  cat > /usr/local/bin/zoneploy-agent-preflight <<'SHIM'
#!/usr/bin/env sh
exec zoneploy-agent preflight "$@"
SHIM

  chmod +x /usr/local/bin/zoneploy-agent \
    /usr/local/bin/zoneploy-agent-status \
    /usr/local/bin/zoneploy-agent-debug \
    /usr/local/bin/zoneploy-agent-audit \
    /usr/local/bin/zoneploy-agent-preflight \
    /usr/local/bin/zoneploy-agent-update \
    /usr/local/bin/zoneploy-agent-repair \
    /usr/local/bin/zoneploy-agent-uninstall
  ok "Installed command shims"
}

write_systemd_service() {
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Zoneploy Self-Hosted Agent
After=network-online.target docker.service
Wants=network-online.target docker.service
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=root
WorkingDirectory=${ZONEPLOY_SOURCE_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/zoneploy-agent serve
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  ok "Wrote systemd service ${SERVICE_NAME}"
}

open_agent_port() {
  local port="${ZONEPLOY_AGENT_PORT}/tcp"

  if command_exists ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$port" >/dev/null 2>&1 || true
    ok "Allowed ${port} through ufw"
    return
  fi

  if command_exists firewall-cmd && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$port" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    ok "Allowed ${port} through firewalld"
    return
  fi

  if command_exists iptables; then
    iptables -C INPUT -p tcp --dport "$ZONEPLOY_AGENT_PORT" -j ACCEPT >/dev/null 2>&1 \
      || iptables -I INPUT -p tcp --dport "$ZONEPLOY_AGENT_PORT" -j ACCEPT >/dev/null 2>&1 || true
    ok "Allowed ${port} through iptables"
  fi
}

open_web_port() {
  local port="${ZONEPLOY_WEB_PORT}/tcp"

  if command_exists ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$port" >/dev/null 2>&1 || true
    ok "Allowed ${port} through ufw"
    return
  fi

  if command_exists firewall-cmd && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$port" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    ok "Allowed ${port} through firewalld"
    return
  fi

  if command_exists iptables; then
    iptables -C INPUT -p tcp --dport "$ZONEPLOY_WEB_PORT" -j ACCEPT >/dev/null 2>&1 \
      || iptables -I INPUT -p tcp --dport "$ZONEPLOY_WEB_PORT" -j ACCEPT >/dev/null 2>&1 || true
    ok "Allowed ${port} through iptables"
  fi
}

open_traefik_port() {
  if [ "$ZONEPLOY_TRAEFIK_ENABLED" != "true" ]; then
    return
  fi

  local port="${ZONEPLOY_TRAEFIK_HTTP_PORT}/tcp"
  local https_port="${ZONEPLOY_TRAEFIK_HTTPS_PORT}/tcp"

  if command_exists ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow "$port" >/dev/null 2>&1 || true
    ufw allow "$https_port" >/dev/null 2>&1 || true
    ok "Allowed ${port} through ufw"
    ok "Allowed ${https_port} through ufw"
    return
  fi

  if command_exists firewall-cmd && systemctl is-active firewalld >/dev/null 2>&1; then
    firewall-cmd --permanent --add-port="$port" >/dev/null 2>&1 || true
    firewall-cmd --permanent --add-port="$https_port" >/dev/null 2>&1 || true
    firewall-cmd --reload >/dev/null 2>&1 || true
    ok "Allowed ${port} through firewalld"
    ok "Allowed ${https_port} through firewalld"
    return
  fi

  if command_exists iptables; then
    iptables -C INPUT -p tcp --dport "$ZONEPLOY_TRAEFIK_HTTP_PORT" -j ACCEPT >/dev/null 2>&1 \
      || iptables -I INPUT -p tcp --dport "$ZONEPLOY_TRAEFIK_HTTP_PORT" -j ACCEPT >/dev/null 2>&1 || true
    iptables -C INPUT -p tcp --dport "$ZONEPLOY_TRAEFIK_HTTPS_PORT" -j ACCEPT >/dev/null 2>&1 \
      || iptables -I INPUT -p tcp --dport "$ZONEPLOY_TRAEFIK_HTTPS_PORT" -j ACCEPT >/dev/null 2>&1 || true
    ok "Allowed ${port} through iptables"
    ok "Allowed ${https_port} through iptables"
  fi
}

compose_file() {
  printf '%s/deploy/docker-compose.yml' "$ZONEPLOY_SOURCE_DIR"
}

compose_cmd() {
  docker compose --env-file "$STACK_ENV_FILE" -p zoneploy -f "$(compose_file)" "$@"
}

assert_zoneploy_stack_created() {
  local services
  services="$(compose_cmd ps --all --services 2>/dev/null || true)"

  if printf '%s\n' "$services" | grep -qx 'web'; then
    return
  fi

  compose_cmd ps --all || true
  compose_cmd logs --tail=80 || true
  fail "Zoneploy stack did not create the web service."
}

prepare_traefik_dynamic_config() {
  install -d -m 0755 "$ZONEPLOY_TRAEFIK_DIR" "$ZONEPLOY_TRAEFIK_DYNAMIC_DIR"

  if [ ! -f "${ZONEPLOY_TRAEFIK_DYNAMIC_DIR}/zoneploy.yml" ]; then
    cat > "${ZONEPLOY_TRAEFIK_DYNAMIC_DIR}/zoneploy.yml" <<TRAEFIK_DYNAMIC
http:
  routers: {}
  services: {}
TRAEFIK_DYNAMIC
  fi
}

start_zoneploy_stack() {
  if [ "$ZONEPLOY_SKIP_DOCKER" = "true" ]; then
    warn "Skipping Zoneploy stack because Docker installation was skipped."
    return
  fi

  [ -f "$(compose_file)" ] || fail "Compose file not found at $(compose_file)."

  prepare_traefik_dynamic_config
  compose_cmd up -d --build
  assert_zoneploy_stack_created

  echo -n "Waiting for Zoneploy web"
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${ZONEPLOY_WEB_PORT}/health" >/dev/null 2>&1; then
      echo ""
      ok "Zoneploy web is healthy"
      return
    fi
    echo -n "."
    sleep 2
  done

  echo ""
  compose_cmd ps || true
  compose_cmd logs --tail=80 api web || true
  fail "Zoneploy web did not become healthy."
}

start_local_registry() {
  if [ "$ZONEPLOY_SKIP_DOCKER" = "true" ]; then
    warn "Skipping local registry because Docker installation was skipped."
    return
  fi

  install -d -m 0755 "$ZONEPLOY_REGISTRY_DIR" "$(dirname "$ZONEPLOY_REGISTRY_CONFIG_FILE")"
  cat > "$ZONEPLOY_REGISTRY_CONFIG_FILE" <<REGISTRY_CONFIG
version: 0.1
log:
  fields:
    service: registry
storage:
  filesystem:
    rootdirectory: /var/lib/registry
  delete:
    enabled: true
http:
  addr: :5000
REGISTRY_CONFIG

  docker rm -f zoneploy-registry >/dev/null 2>&1 || true
  docker run -d \
    --name zoneploy-registry \
    --restart unless-stopped \
    --network zoneploy \
    -p "${ZONEPLOY_REGISTRY_HOST}:${ZONEPLOY_REGISTRY_PORT}:5000" \
    -v "${ZONEPLOY_REGISTRY_CONFIG_FILE}:/etc/docker/registry/config.yml:ro" \
    -v "${ZONEPLOY_REGISTRY_DIR}:/var/lib/registry" \
    registry:2 >/dev/null

  ok "Local registry is running at http://${ZONEPLOY_REGISTRY_HOST}:${ZONEPLOY_REGISTRY_PORT}"
}

start_local_traefik() {
  if [ "$ZONEPLOY_SKIP_DOCKER" = "true" ]; then
    warn "Skipping local Traefik because Docker installation was skipped."
    return
  fi

  if [ "$ZONEPLOY_TRAEFIK_ENABLED" != "true" ]; then
    warn "Skipping local Traefik because it is disabled."
    return
  fi

  install -d -m 0755 "$ZONEPLOY_TRAEFIK_DIR" "$ZONEPLOY_TRAEFIK_DYNAMIC_DIR"

  cat > "${ZONEPLOY_TRAEFIK_DIR}/traefik.yml" <<TRAEFIK
entryPoints:
  web:
    address: ":80"
providers:
  file:
    directory: "/etc/zoneploy/traefik/dynamic"
    watch: true
log:
  level: INFO
TRAEFIK

  if [ ! -f "${ZONEPLOY_TRAEFIK_DYNAMIC_DIR}/zoneploy.yml" ]; then
    cat > "${ZONEPLOY_TRAEFIK_DYNAMIC_DIR}/zoneploy.yml" <<TRAEFIK_DYNAMIC
http:
  routers: {}
  services: {}
TRAEFIK_DYNAMIC
  fi

  docker rm -f zoneploy-traefik >/dev/null 2>&1 || true
  if docker run -d \
    --name zoneploy-traefik \
    --restart unless-stopped \
    --network zoneploy \
    -p "${ZONEPLOY_TRAEFIK_HTTP_PORT}:80" \
    -v "${ZONEPLOY_TRAEFIK_DIR}/traefik.yml:/etc/zoneploy/traefik/traefik.yml:ro" \
    -v "${ZONEPLOY_TRAEFIK_DYNAMIC_DIR}:/etc/zoneploy/traefik/dynamic:ro" \
    traefik:v3 \
    --configFile=/etc/zoneploy/traefik/traefik.yml >/dev/null; then
    ok "Local Traefik is running on HTTP port ${ZONEPLOY_TRAEFIK_HTTP_PORT}"
  else
    warn "Local Traefik could not start. Check if port ${ZONEPLOY_TRAEFIK_HTTP_PORT} is already in use."
  fi
}

start_agent_service() {
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"

  echo -n "Waiting for ${SERVICE_NAME}"
  for _ in $(seq 1 20); do
    if [ "$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)" = "active" ]; then
      echo ""
      ok "${SERVICE_NAME} is active"
      return
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>/dev/null || true
  fail "${SERVICE_NAME} did not become active."
}

safe_rm_rf() {
  local target="${1:-}"

  case "$target" in
    ""|"/"|"/etc"|"/var"|"/opt"|"/usr"|"/usr/local"|"/usr/local/bin")
      fail "Refusing to remove unsafe path: ${target}"
      ;;
  esac

  rm -rf "$target"
}

uninstall_zoneploy() {
  echo "Uninstalling Zoneploy..."
  if [ -f "$(compose_file)" ] && [ -f "$STACK_ENV_FILE" ] && command_exists docker; then
    compose_cmd down --remove-orphans >/dev/null 2>&1 || true
  fi
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  docker rm -f zoneploy-registry >/dev/null 2>&1 || true
  docker rm -f zoneploy-traefik >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload

  rm -f /usr/local/bin/zoneploy-agent \
    /usr/local/bin/zoneploy-agent-status \
    /usr/local/bin/zoneploy-agent-preflight \
    /usr/local/bin/zoneploy-agent-debug \
    /usr/local/bin/zoneploy-agent-audit \
    /usr/local/bin/zoneploy-agent-update \
    /usr/local/bin/zoneploy-agent-repair \
    /usr/local/bin/zoneploy-agent-uninstall

  safe_rm_rf "$ZONEPLOY_SOURCE_DIR"
  rmdir "$ZONEPLOY_HOME" >/dev/null 2>&1 || true

  if [ "$PURGE_DATA" = "true" ]; then
    safe_rm_rf "$ZONEPLOY_CONFIG_DIR"
    safe_rm_rf "$ZONEPLOY_DATA_DIR"
    safe_rm_rf "$ZONEPLOY_LOG_DIR"
    rmdir "$(dirname "$ZONEPLOY_CONFIG_DIR")" >/dev/null 2>&1 || true
  fi

  ok "Zoneploy service and command shims removed"
  if [ "$PURGE_DATA" = "true" ]; then
    ok "Zoneploy config, data and logs removed"
  else
    warn "Config and data were kept. Run uninstall --purge to remove them."
  fi
}

print_summary() {
  local host_ip
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  host_ip="${host_ip:-127.0.0.1}"

  cat <<SUMMARY

========================================
 Zoneploy installation complete
========================================
 Profile:      ${ZONEPLOY_PROFILE}
 Source:       ${ZONEPLOY_SOURCE_DIR}
 Agent config: ${ENV_FILE}
 Stack config: ${STACK_ENV_FILE}
 Dashboard:    http://${host_ip}:${ZONEPLOY_WEB_PORT}
 Registry:     http://${ZONEPLOY_REGISTRY_HOST}:${ZONEPLOY_REGISTRY_PORT}
 Traefik:      enabled=${ZONEPLOY_TRAEFIK_ENABLED}, httpPort=${ZONEPLOY_TRAEFIK_HTTP_PORT}, httpsPort=${ZONEPLOY_TRAEFIK_HTTPS_PORT}
 Cleanup:      enabled=${ZONEPLOY_CLEANUP_ENABLED}, keepReleases=${ZONEPLOY_CLEANUP_KEEP_RELEASES}, keepDays=${ZONEPLOY_CLEANUP_KEEP_DAYS}, maxRegistryGb=${ZONEPLOY_CLEANUP_MAX_REGISTRY_GB}

Commands:
  zoneploy-agent-status
  zoneploy-agent-preflight
  zoneploy-agent-debug
  zoneploy-agent-audit
  zoneploy-agent-update
  zoneploy-agent-repair
  zoneploy-agent-uninstall
  docker compose --env-file ${STACK_ENV_FILE} -p zoneploy -f ${ZONEPLOY_SOURCE_DIR}/deploy/docker-compose.yml logs -f

SUMMARY
}

load_existing_config
ensure_runtime_secrets
require_supported_host

echo ""
echo "========================================"
echo " Zoneploy self-hosted installer"
echo "========================================"
echo "  Action:      ${ACTION}"
echo "  Repo:        ${ZONEPLOY_REPO_URL}"
echo "  Ref:         ${ZONEPLOY_INSTALL_REF}"
echo "  Profile:     ${ZONEPLOY_PROFILE}"
echo "  Agent port:  ${ZONEPLOY_AGENT_PORT}"
echo "  Web port:    ${ZONEPLOY_WEB_PORT}"
echo "  Registry:    ${ZONEPLOY_REGISTRY_HOST}:${ZONEPLOY_REGISTRY_PORT}"
echo "  Traefik:     enabled=${ZONEPLOY_TRAEFIK_ENABLED}, httpPort=${ZONEPLOY_TRAEFIK_HTTP_PORT}, httpsPort=${ZONEPLOY_TRAEFIK_HTTPS_PORT}"
echo "  Package mgr: ${PACKAGE_MANAGER}"
echo ""

if [ "$ACTION" = "uninstall" ]; then
  uninstall_zoneploy
  exit 0
fi

install_base_packages
install_nodejs
install_pnpm
install_docker
prepare_source
build_source
write_env_file
write_stack_env_file
write_command_shims
write_systemd_service
start_agent_service
start_zoneploy_stack
open_agent_port
open_web_port
open_traefik_port
print_summary
