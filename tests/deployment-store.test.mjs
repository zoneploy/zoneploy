import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  listDeployments,
  saveDeployment,
  updateDeploymentStatus,
} from "../packages/runtime/dist/index.js";

const withDeploymentDir = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zoneploy-deployments-"));
  const previous = process.env.ZONEPLOY_DEPLOYMENTS_DIR;
  process.env.ZONEPLOY_DEPLOYMENTS_DIR = dir;

  t.after(async () => {
    if (previous === undefined) {
      delete process.env.ZONEPLOY_DEPLOYMENTS_DIR;
    } else {
      process.env.ZONEPLOY_DEPLOYMENTS_DIR = previous;
    }

    await rm(dir, { recursive: true, force: true });
  });

  return dir;
};

test("deployment store saves and lists local deployments", async (t) => {
  await withDeploymentDir(t);
  const now = new Date().toISOString();

  const deployment = await saveDeployment({
    id: "demo-api",
    appId: "demo-api",
    name: "demo-api",
    releaseId: "release-1",
    image: "127.0.0.1:5000/zoneploy/demo-api:release-1",
    containerName: "zoneploy-demo-api",
    containerPort: 3000,
    hostPort: 8080,
    status: "unknown",
    createdAt: now,
    updatedAt: now,
  });
  await updateDeploymentStatus(deployment, "running", {
    containerId: "container-test",
  });

  const deployments = await listDeployments();

  assert.equal(deployments.length, 1);
  assert.equal(deployments[0].status, "running");
  assert.equal(deployments[0].containerName, "zoneploy-demo-api");
});
