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
  runtime/            Runtime paths, status and routing primitives
  types/              Public contracts shared across packages
```

## Agent commands

The initial agent skeleton exposes JSON commands that will remain stable as the runtime is implemented:

```bash
node apps/agent/dist/index.js status
node apps/agent/dist/index.js routes
node apps/agent/dist/index.js addons
node apps/agent/dist/index.js pairing
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

