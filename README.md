# Zoneploy

Public self-hosted Zoneploy runtime.

This repository contains the installable single-VPS edition of Zoneploy: local
dashboard, API, deploy engine, registry, routing, add-ons and installer. It is a
standalone product and does not depend on Zoneploy Cloud.

## Goals

- Install on a VPS with a single command.
- Run a local dashboard for users, roles, projects and environments.
- Deploy containers and stacks on the same VPS.
- Keep build artifacts in the local private registry.
- Route public apps through local Traefik.
- Keep runtime, add-ons and deploy contracts auditable and documented.

## Repository boundaries

- Self-hosted runtime code belongs here.
- Cloud billing, multi-tenant control plane, remote command polling and internal
  infrastructure do not belong here.
- Shared contracts should stay clean enough to be reused by future products.

## Current structure

```txt
apps/
  api/                Local self-host API
  web/                Local dashboard UI
  agent/              Host helper CLI for diagnostics and operations

packages/
  addons/             Add-on manifests and lifecycle contracts
  installer/          Installer and systemd rendering utilities
  runtime/            Docker, Traefik, registry, diagnostics and deploy runtime
  types/              Public contracts shared across packages

deploy/
  docker-compose.yml  Local self-host stack for API, Web, Postgres, Redis,
                      registry and Traefik
```

## Agent commands

The host helper exposes JSON commands for diagnostics, local builds and local
deployment operations:

```bash
zoneploy-agent status
zoneploy-agent routes
zoneploy-agent addons
zoneploy-agent preflight
zoneploy-agent debug
zoneploy-agent audit
zoneploy-agent build --app demo --context /path/to/app
zoneploy-agent cleanup --apply
zoneploy-agent releases
zoneploy-agent deploy --app demo --release <release-id> --port 3000
zoneploy-agent deployments
zoneploy-agent stop --deployment demo
zoneploy-agent start --deployment demo
zoneploy-agent restart --deployment demo
zoneploy-agent logs --deployment demo --tail 100
zoneploy-agent route --deployment demo --host demo.example.com
zoneploy-agent rollback --deployment demo --release <release-id>
zoneploy-agent remove --deployment demo
zoneploy-agent serve
zoneploy-agent update
zoneploy-agent repair
zoneploy-agent uninstall
```

## Self-Hosted Install

The public installer is designed to be idempotent. It installs the host
prerequisites, builds the local source, writes `/etc/zoneploy/config/agent.env`,
starts the local Docker Compose stack and installs command shims under
`/usr/local/bin`.

```bash
curl -sSL https://zoneploy.com/install.sh | bash
```

Development install from this repository:

```bash
sudo env ZONEPLOY_REPO_URL=https://github.com/zoneploy/zoneploy.git \
  ZONEPLOY_INSTALL_REF=development \
  bash install.sh
```

Operational commands after install:

```bash
zoneploy-agent update
zoneploy-agent repair
zoneploy-agent uninstall
zoneploy-agent uninstall --purge
```

Updates are always manual. Zoneploy does not schedule unattended self-updates.
Upgrade only when you explicitly run `zoneploy-agent update` on the host.

The installer starts a local Docker registry on `127.0.0.1:5000` by default.
Builds push images there so the VPS owns its deploy artifacts and can keep
rollback candidates without consuming external storage.

It also starts a local Traefik edge as `zoneploy-traefik` on HTTP port `80` by
default. Use `--skip-traefik` or `ZONEPLOY_TRAEFIK_ENABLED=false` if another
reverse proxy owns the public port.

The agent HTTP API keeps `/health` public, but protects diagnostic endpoints
with `ZONEPLOY_AGENT_API_TOKEN`. The installer generates this token and stores
it in `/etc/zoneploy/config/agent.env` with `0600` permissions.

```bash
set -a
. /etc/zoneploy/config/agent.env
set +a
curl -H "Authorization: Bearer ${ZONEPLOY_AGENT_API_TOKEN}" http://127.0.0.1:4000/status
```

Registry and cleanup policy can be configured during install or update:

```bash
sudo env \
  ZONEPLOY_REGISTRY_PORT=5000 \
  ZONEPLOY_TRAEFIK_HTTP_PORT=80 \
  ZONEPLOY_CLEANUP_ENABLED=true \
  ZONEPLOY_CLEANUP_KEEP_RELEASES=5 \
  ZONEPLOY_CLEANUP_KEEP_DAYS=14 \
  ZONEPLOY_CLEANUP_MAX_REGISTRY_GB=20 \
  bash install.sh
```

## Local Build Releases

The self-hosted runtime can build Docker images on the VPS, push them to the
local registry and store release metadata under `/var/lib/zoneploy/releases`.

```bash
zoneploy-agent build --app demo-api --context /opt/demo-api
zoneploy-agent releases demo-api
zoneploy-agent deploy --app demo-api --release <release-id> --port 3000
zoneploy-agent deployments
zoneploy-agent stop --deployment demo-api
zoneploy-agent start --deployment demo-api
zoneploy-agent restart --deployment demo-api
zoneploy-agent logs --deployment demo-api --tail 100
zoneploy-agent route --deployment demo-api --host demo.example.com
zoneploy-agent routes
zoneploy-agent rollback --deployment demo-api --release <previous-release-id>
zoneploy-agent remove --deployment demo-api
zoneploy-agent cleanup
zoneploy-agent cleanup --apply
```

Images are tagged as:

```txt
127.0.0.1:5000/zoneploy/<app-id>:<release-id>
```

This keeps rollback candidates on the user's VPS.

## Local Dashboard Direction

The local API and Web apps are being adapted from the Cloud UI to a single-VPS
self-host product. The final flow is:

1. First boot creates the owner user.
2. The owner invites users and assigns local roles.
3. Projects and environments group containers and stacks.
4. Git providers are configured locally so private repositories can be cloned
   and built on the VPS.
5. Custom app domains point directly to the VPS and are terminated by local
   Traefik.

Public registry push from CI is intentionally out of this initial scope. The
default registry remains private on `127.0.0.1`.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Local commands

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```
