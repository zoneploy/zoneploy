# Zoneploy

Public self-hosted Zoneploy runtime.

This repository will contain the installable single-VPS edition of Zoneploy: local dashboard, server agent, deploy engine, routing, add-ons and installer.

## Goals

- Install on a VPS with a single command.
- Work standalone without Zoneploy Cloud.
- Pair with Zoneploy Cloud when the user wants centralized management.
- Keep runtime, add-ons and deploy contracts auditable and documented.

## Repository boundaries

- Self-hosted runtime code belongs here.
- Cloud billing, multi-tenant control plane and internal infrastructure do not belong here.
- Shared contracts should stay clean enough to be reused by Zoneploy Cloud.

## Current structure

```txt
apps/
  agent/              Self-hosted agent CLI and future local API

packages/
  addons/             Add-on manifests and lifecycle contracts
  installer/          Installer and systemd rendering utilities
  runtime/            Host detection, diagnostics, status and routing primitives
  types/              Public contracts shared across packages
```

## Agent commands

The initial agent skeleton exposes JSON commands that will remain stable as the runtime is implemented:

```bash
node apps/agent/dist/index.js status
node apps/agent/dist/index.js routes
node apps/agent/dist/index.js addons
node apps/agent/dist/index.js pairing
node apps/agent/dist/index.js preflight
node apps/agent/dist/index.js debug
node apps/agent/dist/index.js audit
node apps/agent/dist/index.js build --app demo --context /path/to/app
node apps/agent/dist/index.js cleanup --apply
node apps/agent/dist/index.js releases
node apps/agent/dist/index.js deploy --app demo --release <release-id> --port 3000
node apps/agent/dist/index.js deployments
node apps/agent/dist/index.js route --deployment demo --host demo.example.com
node apps/agent/dist/index.js rollback --deployment demo --release <release-id>
node apps/agent/dist/index.js serve
node apps/agent/dist/index.js update
node apps/agent/dist/index.js repair
node apps/agent/dist/index.js uninstall
```

## Self-Hosted Install

The public installer is designed to be idempotent. It installs Node.js, pnpm and
Docker, builds the local source, writes `/etc/zoneploy/config/agent.env`,
registers `zoneploy-agent.service` and installs command shims under
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

The installer also starts a local Docker registry on `127.0.0.1:5000` by
default. Builds should push images there so the VPS owns its deploy artifacts
and can keep rollback candidates without consuming Zoneploy Cloud storage.
It also starts a local Traefik edge as `zoneploy-traefik` on HTTP port `80` by
default. Use `--skip-traefik` or `ZONEPLOY_TRAEFIK_ENABLED=false` if another
reverse proxy owns the public port.

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

These values are written to `/etc/zoneploy/config/agent.env` so a future local
dashboard or Zoneploy Cloud pairing can expose the same policy without changing
the runtime contract.

## Local Build Releases

The self-hosted runtime can build Docker images on the VPS, push them to the
local registry and store release metadata under `/var/lib/zoneploy/releases`.

```bash
zoneploy-agent build --app demo-api --context /opt/demo-api
zoneploy-agent releases demo-api
zoneploy-agent deploy --app demo-api --release <release-id> --port 3000
zoneploy-agent deployments
zoneploy-agent route --deployment demo-api --host demo.example.com
zoneploy-agent routes
zoneploy-agent rollback --deployment demo-api --release <previous-release-id>
zoneploy-agent cleanup
zoneploy-agent cleanup --apply
```

Images are tagged as:

```txt
127.0.0.1:5000/zoneploy/<app-id>:<release-id>
```

This keeps rollback candidates on the user's VPS instead of using Zoneploy
Cloud storage or bandwidth.

Local deploys are intentionally driven from a ready release. The deploy command
replaces the previous managed container for the same app, runs the new image on
the `zoneploy` Docker network and stores deployment metadata under
`/var/lib/zoneploy/deployments`.

Routes are stored under `/etc/zoneploy/runtime-routes` and rendered to Traefik's
dynamic file provider at `/etc/zoneploy/traefik/dynamic/zoneploy.yml`.

Cleanup defaults to dry-run. Use `--apply` to delete release metadata, local
Docker images and local registry manifests according to the configured count and
age retention policy. Active deployment releases are always protected.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Local commands

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

