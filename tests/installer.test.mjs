import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDefaultInstallPaths,
  renderAgentEnvironment,
  renderCommandShim,
  renderOperationShim,
  renderSystemdService,
} from "../packages/installer/dist/index.js";

test("installer renders default filesystem paths", () => {
  const paths = createDefaultInstallPaths();

  assert.equal(paths.homeDir, "/opt/zoneploy");
  assert.equal(paths.sourceDir, "/opt/zoneploy/source");
  assert.equal(paths.envFile, "/etc/zoneploy/config/agent.env");
  assert.equal(paths.routesDir, "/etc/zoneploy/runtime-routes");
  assert.equal(paths.registryDir, "/var/lib/zoneploy/registry");
  assert.equal(paths.registryConfigFile, "/etc/zoneploy/config/registry.yml");
  assert.equal(paths.buildsDir, "/var/lib/zoneploy/builds");
  assert.equal(paths.releasesDir, "/var/lib/zoneploy/releases");
  assert.equal(paths.deploymentsDir, "/var/lib/zoneploy/deployments");
  assert.equal(paths.appsDir, "/var/lib/zoneploy/apps");
  assert.equal(paths.traefikDynamicDir, "/etc/zoneploy/traefik/dynamic");
});

test("installer renders agent environment without leaking unset pairing values", () => {
  const env = renderAgentEnvironment({
    profile: "standalone",
    agentPort: 4000,
    paths: createDefaultInstallPaths(),
  });

  assert.match(env, /ZONEPLOY_PROFILE=standalone/);
  assert.match(env, /ZONEPLOY_AGENT_PORT=4000/);
  assert.match(env, /ZONEPLOY_REGISTRY_HOST=127\.0\.0\.1/);
  assert.match(env, /ZONEPLOY_REGISTRY_PORT=5000/);
  assert.match(env, /ZONEPLOY_ROUTES_DIR=\/etc\/zoneploy\/runtime-routes/);
  assert.match(env, /ZONEPLOY_REGISTRY_DIR=\/var\/lib\/zoneploy\/registry/);
  assert.match(env, /ZONEPLOY_REGISTRY_CONFIG_FILE=\/etc\/zoneploy\/config\/registry\.yml/);
  assert.match(env, /ZONEPLOY_DEPLOYMENTS_DIR=\/var\/lib\/zoneploy\/deployments/);
  assert.match(env, /ZONEPLOY_TRAEFIK_ENABLED=true/);
  assert.match(env, /ZONEPLOY_TRAEFIK_HTTP_PORT=80/);
  assert.match(env, /ZONEPLOY_CLEANUP_ENABLED=true/);
  assert.match(env, /ZONEPLOY_CLEANUP_KEEP_RELEASES=5/);
  assert.match(env, /ZONEPLOY_CLEANUP_KEEP_DAYS=14/);
  assert.match(env, /ZONEPLOY_CLEANUP_MAX_REGISTRY_GB=20/);
  assert.doesNotMatch(env, /ZONEPLOY_PAIRING_TOKEN/);
});

test("installer renders configurable registry and cleanup policy", () => {
  const env = renderAgentEnvironment({
    profile: "paired",
    agentPort: 4100,
    registryHost: "127.0.0.1",
    registryPort: 5100,
    cleanupPolicy: {
      enabled: false,
      keepReleases: 9,
      keepDays: 30,
      maxRegistryGb: 80,
    },
    paths: createDefaultInstallPaths(),
  });

  assert.match(env, /ZONEPLOY_AGENT_PORT=4100/);
  assert.match(env, /ZONEPLOY_REGISTRY_PORT=5100/);
  assert.match(env, /ZONEPLOY_CLEANUP_ENABLED=false/);
  assert.match(env, /ZONEPLOY_CLEANUP_KEEP_RELEASES=9/);
  assert.match(env, /ZONEPLOY_CLEANUP_KEEP_DAYS=30/);
  assert.match(env, /ZONEPLOY_CLEANUP_MAX_REGISTRY_GB=80/);
});

test("installer renders a systemd service for the persistent agent server", () => {
  const service = renderSystemdService({
    serviceName: "zoneploy-agent",
    workingDirectory: "/opt/zoneploy/source",
    command: "/usr/local/bin/zoneploy-agent serve",
    environmentFile: "/etc/zoneploy/config/agent.env",
  });

  assert.match(service, /ExecStart=\/usr\/local\/bin\/zoneploy-agent serve/);
  assert.match(service, /Restart=always/);
  assert.match(service, /User=root/);
});

test("installer renders command shim that loads the agent environment", () => {
  const shim = renderCommandShim("/opt/zoneploy/source", "/etc/zoneploy/config/agent.env");

  assert.match(shim, /set -a/);
  assert.match(shim, /apps\/agent\/dist\/index\.js/);
});

test("installer renders operation shim through a temporary install script copy", () => {
  const shim = renderOperationShim(
    "/opt/zoneploy/source",
    "/etc/zoneploy/config/agent.env",
    "update",
  );

  assert.match(shim, /mktemp \/tmp\/zoneploy-install\.XXXXXX/);
  assert.match(shim, /unset NODE_ENV/);
  assert.match(shim, /PNPM_CONFIG_PROD=false/);
  assert.match(shim, /set \+e/);
  assert.match(shim, /bash "\$tmp" update "\$@"/);
  assert.match(shim, /set -e/);
  assert.match(shim, /rm -f "\$tmp"/);
});
