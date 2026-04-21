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
ZONEPLOY_PROFILE="${ZONEPLOY_PROFILE:-standalone}"
ZONEPLOY_CLOUD_URL="${ZONEPLOY_CLOUD_URL:-}"
ZONEPLOY_PAIRING_TOKEN="${ZONEPLOY_PAIRING_TOKEN:-}"
ZONEPLOY_INSTANCE_ID="${ZONEPLOY_INSTANCE_ID:-}"
ZONEPLOY_SKIP_DOCKER="${ZONEPLOY_SKIP_DOCKER:-false}"

ACTION="install"
PURGE_DATA="false"
SERVICE_NAME="zoneploy-agent"
ENV_FILE="${ZONEPLOY_CONFIG_DIR}/agent.env"
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
  --ref <git-ref>           Git ref to install. Default: development
  --repo <url>              Git repository URL. Default: https://github.com/zoneploy/zoneploy.git
  --paired                  Configure the agent as paired with Zoneploy Cloud
  --cloud-url <url>         Zoneploy Cloud API URL for paired mode
  --pairing-token <token>   One-time pairing token for paired mode
  --skip-docker             Do not install or start Docker
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
    --ref)
      ZONEPLOY_INSTALL_REF="${2:?--ref requires a value}"
      shift 2
      ;;
    --repo)
      ZONEPLOY_REPO_URL="${2:?--repo requires a value}"
      shift 2
      ;;
    --paired)
      ZONEPLOY_PROFILE="paired"
      shift
      ;;
    --cloud-url)
      ZONEPLOY_CLOUD_URL="${2:?--cloud-url requires a value}"
      shift 2
      ;;
    --pairing-token)
      ZONEPLOY_PAIRING_TOKEN="${2:?--pairing-token requires a value}"
      shift 2
      ;;
    --skip-docker)
      ZONEPLOY_SKIP_DOCKER="true"
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
    standalone|paired) ;;
    *) fail "ZONEPLOY_PROFILE must be standalone or paired." ;;
  esac

  case "$ZONEPLOY_AGENT_PORT" in
    ''|*[!0-9]*) fail "ZONEPLOY_AGENT_PORT must be a TCP port number." ;;
  esac

  [ "$ZONEPLOY_AGENT_PORT" -ge 1 ] && [ "$ZONEPLOY_AGENT_PORT" -le 65535 ] \
    || fail "ZONEPLOY_AGENT_PORT must be between 1 and 65535."

  if [ "$ZONEPLOY_PROFILE" = "paired" ] && [ -z "$ZONEPLOY_CLOUD_URL" ]; then
    fail "Paired mode requires --cloud-url or ZONEPLOY_CLOUD_URL."
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
  pnpm install --frozen-lockfile
  pnpm build
}

shell_quote() {
  local value="${1:-}"
  value="${value//\'/\'\"\'\"\'}"
  printf "'%s'" "$value"
}

write_env_file() {
  install -d -m 0755 "$ZONEPLOY_CONFIG_DIR" "$ZONEPLOY_DATA_DIR" "$ZONEPLOY_LOG_DIR"
  umask 077
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
ZONEPLOY_PROFILE=$(shell_quote "$ZONEPLOY_PROFILE")
ZONEPLOY_AGENT_PORT=$(shell_quote "$ZONEPLOY_AGENT_PORT")
ZONEPLOY_HOME=$(shell_quote "$ZONEPLOY_HOME")
ZONEPLOY_SOURCE_DIR=$(shell_quote "$ZONEPLOY_SOURCE_DIR")
ZONEPLOY_CONFIG_DIR=$(shell_quote "$ZONEPLOY_CONFIG_DIR")
ZONEPLOY_DATA_DIR=$(shell_quote "$ZONEPLOY_DATA_DIR")
ZONEPLOY_LOG_DIR=$(shell_quote "$ZONEPLOY_LOG_DIR")
ZONEPLOY_CLOUD_URL=$(shell_quote "$ZONEPLOY_CLOUD_URL")
ZONEPLOY_PAIRING_TOKEN=$(shell_quote "$ZONEPLOY_PAIRING_TOKEN")
ZONEPLOY_INSTANCE_ID=$(shell_quote "$ZONEPLOY_INSTANCE_ID")
ENV
  chmod 600 "$ENV_FILE"
  ok "Wrote $ENV_FILE"
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

[Service]
Type=simple
User=root
WorkingDirectory=${ZONEPLOY_SOURCE_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/zoneploy-agent serve
Restart=always
RestartSec=5
StartLimitIntervalSec=120
StartLimitBurst=5
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
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
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
 Config:       ${ENV_FILE}
 Service:      ${SERVICE_NAME}
 Agent API:    http://${host_ip}:${ZONEPLOY_AGENT_PORT}

Commands:
  zoneploy-agent-status
  zoneploy-agent-preflight
  zoneploy-agent-debug
  zoneploy-agent-audit
  zoneploy-agent-update
  zoneploy-agent-repair
  zoneploy-agent-uninstall
  journalctl -u ${SERVICE_NAME} -f

SUMMARY
}

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
write_command_shims
write_systemd_service
open_agent_port
start_agent_service
print_summary
