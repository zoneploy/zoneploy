import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

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

test("agent preflight command returns host checks without crashing", () => {
  const preflight = runAgent("preflight");

  assert.equal(typeof preflight.checkedAt, "string");
  assert.equal(typeof preflight.runtimeInfo, "object");
  assert.ok(Array.isArray(preflight.ports));
  assert.equal(typeof preflight.summary.errors, "number");
});

test("agent debug command returns diagnostic sections", () => {
  const debug = runAgent("debug");

  assert.equal(debug.agentVersion, "0.0.0");
  assert.equal(typeof debug.hostname, "string");
  assert.ok(Array.isArray(debug.runtime));
  assert.equal(typeof debug.routes, "object");
});

test("agent audit command returns summarized checks", () => {
  const audit = runAgent("audit");

  assert.equal(audit.agentVersion, "0.0.0");
  assert.ok(Array.isArray(audit.sections));
  assert.equal(typeof audit.summary.pass, "number");
  assert.equal(typeof audit.summary.warn, "number");
  assert.equal(typeof audit.summary.fail, "number");
});
