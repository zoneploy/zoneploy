import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDefaultInstallPaths,
  renderAgentEnvironment,
  renderCommandShim,
  renderSystemdService,
} from "../packages/installer/dist/index.js";

test("installer renders default filesystem paths", () => {
  const paths = createDefaultInstallPaths();

  assert.equal(paths.homeDir, "/opt/zoneploy");
  assert.equal(paths.sourceDir, "/opt/zoneploy/source");
  assert.equal(paths.envFile, "/etc/zoneploy/config/agent.env");
});

test("installer renders agent environment without leaking unset pairing values", () => {
  const env = renderAgentEnvironment({
    profile: "standalone",
    agentPort: 4000,
    paths: createDefaultInstallPaths(),
  });

  assert.match(env, /ZONEPLOY_PROFILE=standalone/);
  assert.match(env, /ZONEPLOY_AGENT_PORT=4000/);
  assert.doesNotMatch(env, /ZONEPLOY_PAIRING_TOKEN/);
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
