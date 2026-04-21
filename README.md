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

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

## Local commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

