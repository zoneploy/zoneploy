import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const readJsonBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
};

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

test("cloud-sync polls one cloud command and reports the result", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zoneploy-cloud-sync-"));
  const pollRequests = [];
  const results = [];
  const previousEnv = {
    ZONEPLOY_PROFILE: process.env.ZONEPLOY_PROFILE,
    ZONEPLOY_CLOUD_URL: process.env.ZONEPLOY_CLOUD_URL,
    ZONEPLOY_INSTANCE_ID: process.env.ZONEPLOY_INSTANCE_ID,
    ZONEPLOY_AGENT_TOKEN: process.env.ZONEPLOY_AGENT_TOKEN,
    ZONEPLOY_ROUTES_DIR: process.env.ZONEPLOY_ROUTES_DIR,
    ZONEPLOY_DEPLOYMENTS_DIR: process.env.ZONEPLOY_DEPLOYMENTS_DIR,
    ZONEPLOY_REGISTRY_DIR: process.env.ZONEPLOY_REGISTRY_DIR,
  };

  const server = await withServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer agent-token-test");

    if (request.method === "POST" && request.url === "/api/v1/agent/poll") {
      const body = await readJsonBody(request);
      pollRequests.push(body);

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          commands: [
            {
              id: "cmd-status-test",
              action: { type: "status" },
            },
          ],
        }),
      );
      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/api/v1/agent/commands/cmd-status-test/result"
    ) {
      const body = await readJsonBody(request);
      results.push(body);

      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
  });

  t.after(async () => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  process.env.ZONEPLOY_PROFILE = "paired";
  process.env.ZONEPLOY_CLOUD_URL = server.url;
  process.env.ZONEPLOY_INSTANCE_ID = "instance-test";
  process.env.ZONEPLOY_AGENT_TOKEN = "agent-token-test";
  process.env.ZONEPLOY_ROUTES_DIR = join(root, "routes");
  process.env.ZONEPLOY_DEPLOYMENTS_DIR = join(root, "deployments");
  process.env.ZONEPLOY_REGISTRY_DIR = join(root, "registry");

  const { runCloudCommandPollOnce } = await import("../apps/agent/dist/cloud-worker.js");
  const sync = await runCloudCommandPollOnce();

  assert.equal(sync.paired, true);
  assert.equal(sync.commandCount, 1);
  assert.deepEqual(sync.commandIds, ["cmd-status-test"]);
  assert.equal(pollRequests.length, 1);
  assert.equal(pollRequests[0].instanceId, "instance-test");
  assert.equal(typeof pollRequests[0].heartbeat.agent, "object");
  assert.equal(results.length, 1);
  assert.equal(results[0].commandId, "cmd-status-test");
  assert.equal(results[0].status, "succeeded");
  assert.equal(results[0].output.agentVersion, "0.0.0");
});
