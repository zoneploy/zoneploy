import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const runAgent = (command) => {
  const output = execFileSync("node", ["apps/agent/dist/index.js", command], {
    encoding: "utf8",
  });

  return JSON.parse(output);
};

test("agent status command returns the public status contract", () => {
  const status = runAgent("status");

  assert.equal(status.agentVersion, "0.0.0");
  assert.equal(status.mode, "standalone");
  assert.equal(status.health, "unknown");
  assert.ok(Array.isArray(status.capabilities));
  assert.ok(Array.isArray(status.services));
  assert.ok(Array.isArray(status.runtime));
  assert.equal(status.registry.url, "http://127.0.0.1:5000");
  assert.equal(status.registry.cleanupPolicy.keepReleases, 5);
});

test("agent addons command returns built-in addon manifests", () => {
  const addons = runAgent("addons");
  const slugs = addons.map((addon) => addon.slug);

  assert.ok(slugs.includes("custom-domains-edge"));
  assert.ok(slugs.includes("firewall-manager"));
});

test("agent routes command returns an empty route snapshot by default", () => {
  const routes = runAgent("routes");

  assert.ok(Array.isArray(routes.routes));
  assert.equal(routes.routes.length, 0);
});

test("agent pairing command is unpaired by default", () => {
  const pairing = runAgent("pairing");

  assert.equal(pairing.paired, false);
});

test("agent pairing command reports cloud pairing from environment", () => {
  const output = execFileSync("node", ["apps/agent/dist/index.js", "pairing"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ZONEPLOY_PROFILE: "paired",
      ZONEPLOY_CLOUD_URL: "https://api.zoneploy.com",
      ZONEPLOY_INSTANCE_ID: "instance-test",
    },
  });
  const pairing = JSON.parse(output);

  assert.equal(pairing.paired, true);
  assert.equal(pairing.cloudUrl, "https://api.zoneploy.com");
  assert.equal(pairing.instanceId, "instance-test");
});

test("agent preflight command returns host checks without crashing", () => {
  const preflight = runAgent("preflight");

  assert.equal(typeof preflight.checkedAt, "string");
  assert.equal(typeof preflight.runtimeInfo, "object");
  assert.ok(Array.isArray(preflight.ports));
  assert.equal(typeof preflight.summary.errors, "number");
});

test("agent preflight does not flag its own running server as an agent port conflict", async (t) => {
  const port = 46_000 + Math.floor(Math.random() * 1_000);
  const child = spawn("node", ["apps/agent/dist/index.js", "serve"], {
    env: {
      ...process.env,
      ZONEPLOY_AGENT_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    child.kill("SIGTERM");
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        break;
      }
    } catch {
      await sleep(100);
    }
  }

  const output = execFileSync("node", ["apps/agent/dist/index.js", "preflight"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ZONEPLOY_AGENT_PORT: String(port),
    },
  });
  const preflight = JSON.parse(output);

  assert.ok(
    preflight.conflicts.every((conflict) => conflict.code !== "AGENT_PORT_IN_USE"),
    "preflight should ignore the running Zoneploy agent process",
  );
});

test("agent debug command returns diagnostic sections", () => {
  const debug = runAgent("debug");

  assert.equal(debug.agentVersion, "0.0.0");
  assert.equal(typeof debug.hostname, "string");
  assert.ok(Array.isArray(debug.runtime));
  assert.equal(typeof debug.routes, "object");
  assert.equal(typeof debug.registry, "object");
  assert.equal(debug.registry.cleanupPolicy.maxRegistryGb, 20);
});

test("agent audit command returns summarized checks", () => {
  const audit = runAgent("audit");

  assert.equal(audit.agentVersion, "0.0.0");
  assert.ok(Array.isArray(audit.sections));
  assert.equal(typeof audit.summary.pass, "number");
  assert.equal(typeof audit.summary.warn, "number");
  assert.equal(typeof audit.summary.fail, "number");
});

test("agent serve command exposes the health endpoint", async (t) => {
  const port = 45_000 + Math.floor(Math.random() * 1_000);
  const child = spawn("node", ["apps/agent/dist/index.js", "serve"], {
    env: {
      ...process.env,
      ZONEPLOY_AGENT_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(() => {
    child.kill("SIGTERM");
  });

  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`);
      break;
    } catch {
      await sleep(100);
    }
  }

  assert.ok(response, "server did not start");
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.status, "ok");
});
