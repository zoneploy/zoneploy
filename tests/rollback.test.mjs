import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { rollbackLocalDeployment } from "../packages/runtime/dist/index.js";

test("rollback returns the current deployment when already on target release", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zoneploy-rollback-"));
  const previousDeployments = process.env.ZONEPLOY_DEPLOYMENTS_DIR;
  process.env.ZONEPLOY_DEPLOYMENTS_DIR = root;

  t.after(async () => {
    if (previousDeployments === undefined) {
      delete process.env.ZONEPLOY_DEPLOYMENTS_DIR;
    } else {
      process.env.ZONEPLOY_DEPLOYMENTS_DIR = previousDeployments;
    }

    await rm(root, { recursive: true, force: true });
  });

  const { saveDeployment } = await import("../packages/runtime/dist/index.js");
  const now = new Date().toISOString();
  await saveDeployment({
    id: "demo-api",
    appId: "demo-api",
    name: "demo-api",
    releaseId: "release-current",
    image: "127.0.0.1:5000/zoneploy/demo-api:release-current",
    containerName: "zoneploy-demo-api",
    containerPort: 80,
    status: "running",
    createdAt: now,
    updatedAt: now,
  });

  const result = await rollbackLocalDeployment({
    deploymentName: "demo-api",
    releaseId: "release-current",
  });

  assert.equal(result.deployment.releaseId, "release-current");
  assert.equal(result.deployment.status, "running");
});
