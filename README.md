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

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Local commands

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

