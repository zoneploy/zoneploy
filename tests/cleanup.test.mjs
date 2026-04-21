import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanupLocalRuntime,
  createLocalImageReference,
  listReleases,
  saveDeployment,
  saveRelease,
} from "../packages/runtime/dist/index.js";

const withRuntimeDirs = async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zoneploy-cleanup-"));
  const previousReleases = process.env.ZONEPLOY_RELEASES_DIR;
  const previousDeployments = process.env.ZONEPLOY_DEPLOYMENTS_DIR;
  const previousKeepReleases = process.env.ZONEPLOY_CLEANUP_KEEP_RELEASES;
  const previousKeepDays = process.env.ZONEPLOY_CLEANUP_KEEP_DAYS;
  process.env.ZONEPLOY_RELEASES_DIR = join(root, "releases");
  process.env.ZONEPLOY_DEPLOYMENTS_DIR = join(root, "deployments");
  process.env.ZONEPLOY_CLEANUP_KEEP_RELEASES = "1";
  process.env.ZONEPLOY_CLEANUP_KEEP_DAYS = "0";

  t.after(async () => {
    const restore = (key, value) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore("ZONEPLOY_RELEASES_DIR", previousReleases);
    restore("ZONEPLOY_DEPLOYMENTS_DIR", previousDeployments);
    restore("ZONEPLOY_CLEANUP_KEEP_RELEASES", previousKeepReleases);
    restore("ZONEPLOY_CLEANUP_KEEP_DAYS", previousKeepDays);
    await rm(root, { recursive: true, force: true });
  });
};

const makeRelease = async (appId, releaseId, createdAt) => {
  const image = createLocalImageReference({ appId, releaseId });

  return saveRelease({
    id: releaseId,
    appId,
    ...image,
    status: "ready",
    source: {
      contextDir: "/tmp/demo",
      dockerfile: "/tmp/demo/Dockerfile",
    },
    createdAt,
    updatedAt: createdAt,
  });
};

test("cleanup dry-run protects active release and selects old releases", async (t) => {
  await withRuntimeDirs(t);
  const oldRelease = await makeRelease("demo-api", "release-old", "2026-04-19T00:00:00.000Z");
  const activeRelease = await makeRelease("demo-api", "release-active", "2026-04-21T00:00:00.000Z");
  const now = new Date().toISOString();
  await saveDeployment({
    id: "demo-api",
    appId: "demo-api",
    name: "demo-api",
    releaseId: activeRelease.id,
    image: activeRelease.image,
    containerName: "zoneploy-demo-api",
    containerPort: 80,
    status: "running",
    createdAt: now,
    updatedAt: now,
  });

  const result = await cleanupLocalRuntime(true);
  const releases = await listReleases("demo-api");

  assert.equal(result.dryRun, true);
  assert.equal(result.deletedReleases.length, 1);
  assert.equal(result.deletedReleases[0].releaseId, oldRelease.id);
  assert.equal(result.keptActiveReleaseIds.includes(activeRelease.id), true);
  assert.equal(releases.length, 2);
});
