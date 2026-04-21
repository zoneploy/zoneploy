import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pairAgentWithCloud } from "../packages/runtime/dist/index.js";

const withServer = async (handler) => {
  const server = http.createServer(handler);

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
};

test("pairing exchanges a one-time token and persists cloud credentials", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zoneploy-pairing-"));
  const envFile = join(root, "agent.env");
  const previousEnvFile = process.env.ZONEPLOY_AGENT_ENV_FILE;
  const previousProfile = process.env.ZONEPLOY_PROFILE;
  const previousCloudUrl = process.env.ZONEPLOY_CLOUD_URL;
  const previousInstanceId = process.env.ZONEPLOY_INSTANCE_ID;
  const previousAgentToken = process.env.ZONEPLOY_AGENT_TOKEN;
  const previousPairingToken = process.env.ZONEPLOY_PAIRING_TOKEN;
  process.env.ZONEPLOY_AGENT_ENV_FILE = envFile;
  await writeFile(envFile, "ZONEPLOY_PROFILE=standalone\n", "utf8");

  const server = await withServer((request, response) => {
    assert.equal(request.url, "/api/v1/agent/pair");
    assert.equal(request.headers.authorization, "Bearer pair-token-test");

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        instanceId: "instance-test",
        agentToken: "agent-token-test",
        pairedAt: "2026-04-21T00:00:00.000Z",
      }),
    );
  });

  t.after(async () => {
    const restore = (key, value) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore("ZONEPLOY_AGENT_ENV_FILE", previousEnvFile);
    restore("ZONEPLOY_PROFILE", previousProfile);
    restore("ZONEPLOY_CLOUD_URL", previousCloudUrl);
    restore("ZONEPLOY_INSTANCE_ID", previousInstanceId);
    restore("ZONEPLOY_AGENT_TOKEN", previousAgentToken);
    restore("ZONEPLOY_PAIRING_TOKEN", previousPairingToken);
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  const result = await pairAgentWithCloud(
    {
      cloudUrl: server.url,
      pairingToken: "pair-token-test",
      instanceName: "test-instance",
    },
    "0.0.0-test",
  );
  const env = await readFile(envFile, "utf8");

  assert.equal(result.instanceId, "instance-test");
  assert.equal(result.agentTokenSet, true);
  assert.match(env, /ZONEPLOY_PROFILE=paired/);
  assert.match(env, /ZONEPLOY_CLOUD_URL=http:\/\/127\.0\.0\.1:\d+/);
  assert.match(env, /ZONEPLOY_INSTANCE_ID=instance-test/);
  assert.match(env, /ZONEPLOY_AGENT_TOKEN=agent-token-test/);
  assert.doesNotMatch(env, /ZONEPLOY_PAIRING_TOKEN/);
});
