import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createLocalImageReference,
  createReleaseSnapshot,
  saveRelease,
  updateReleaseStatus,
} from "../packages/runtime/dist/index.js";

const withReleaseDir = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "zoneploy-releases-"));
  const previous = process.env.ZONEPLOY_RELEASES_DIR;
  process.env.ZONEPLOY_RELEASES_DIR = dir;

  t.after(async () => {
    if (previous === undefined) {
      delete process.env.ZONEPLOY_RELEASES_DIR;
    } else {
      process.env.ZONEPLOY_RELEASES_DIR = previous;
    }

    await rm(dir, { recursive: true, force: true });
  });

  return dir;
};

test("release store saves and lists local image releases", async (t) => {
  await withReleaseDir(t);
  const image = createLocalImageReference({
    appId: "Demo App",
    releaseId: "20260421T010203Z-test",
  });
  const now = new Date().toISOString();

  const release = await saveRelease({
    id: "20260421T010203Z-test",
    appId: "Demo App",
    ...image,
    status: "building",
    source: {
      contextDir: "/tmp/demo",
      dockerfile: "/tmp/demo/Dockerfile",
    },
    createdAt: now,
    updatedAt: now,
  });

  const ready = await updateReleaseStatus(release, "ready");
  const snapshot = await createReleaseSnapshot("Demo App");

  assert.equal(ready.status, "ready");
  assert.equal(snapshot.releases.length, 1);
  assert.equal(snapshot.releases[0].image, "127.0.0.1:5000/zoneploy/demo-app:20260421T010203Z-test");
});

test("release store normalizes app ids into local registry repositories", () => {
  const image = createLocalImageReference({
    appId: "My API Service!",
    releaseId: "release-1",
    registryUrl: "http://127.0.0.1:5100",
  });

  assert.equal(image.registryUrl, "http://127.0.0.1:5100");
  assert.equal(image.imageRepository, "127.0.0.1:5100/zoneploy/my-api-service");
  assert.equal(image.image, "127.0.0.1:5100/zoneploy/my-api-service:release-1");
});
