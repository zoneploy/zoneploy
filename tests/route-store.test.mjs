import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createRouteSnapshot,
  renderTraefikDynamicConfig,
  routeLocalDeployment,
  saveDeployment,
} from "../packages/runtime/dist/index.js";

const withRouteDirs = async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zoneploy-routes-"));
  const routesDir = join(root, "routes");
  const traefikDynamicDir = join(root, "dynamic");
  const deploymentsDir = join(root, "deployments");
  const previousRoutes = process.env.ZONEPLOY_ROUTES_DIR;
  const previousTraefik = process.env.ZONEPLOY_TRAEFIK_DYNAMIC_DIR;
  const previousDeployments = process.env.ZONEPLOY_DEPLOYMENTS_DIR;
  process.env.ZONEPLOY_ROUTES_DIR = routesDir;
  process.env.ZONEPLOY_TRAEFIK_DYNAMIC_DIR = traefikDynamicDir;
  process.env.ZONEPLOY_DEPLOYMENTS_DIR = deploymentsDir;

  t.after(async () => {
    if (previousRoutes === undefined) {
      delete process.env.ZONEPLOY_ROUTES_DIR;
    } else {
      process.env.ZONEPLOY_ROUTES_DIR = previousRoutes;
    }

    if (previousTraefik === undefined) {
      delete process.env.ZONEPLOY_TRAEFIK_DYNAMIC_DIR;
    } else {
      process.env.ZONEPLOY_TRAEFIK_DYNAMIC_DIR = previousTraefik;
    }

    if (previousDeployments === undefined) {
      delete process.env.ZONEPLOY_DEPLOYMENTS_DIR;
    } else {
      process.env.ZONEPLOY_DEPLOYMENTS_DIR = previousDeployments;
    }

    await rm(root, { recursive: true, force: true });
  });

  return { routesDir, traefikDynamicDir, deploymentsDir };
};

test("route store routes a running deployment through Traefik", async (t) => {
  const { traefikDynamicDir } = await withRouteDirs(t);
  const now = new Date().toISOString();

  await saveDeployment({
    id: "demo-api",
    appId: "demo-api",
    name: "demo-api",
    releaseId: "release-1",
    image: "127.0.0.1:5000/zoneploy/demo-api:release-1",
    containerName: "zoneploy-demo-api",
    containerPort: 3000,
    status: "running",
    createdAt: now,
    updatedAt: now,
  });

  const result = await routeLocalDeployment({
    deploymentName: "demo-api",
    host: "Demo.Example.com.",
  });
  const snapshot = await createRouteSnapshot();
  const traefikConfig = await readFile(join(traefikDynamicDir, "zoneploy.yml"), "utf8");

  assert.equal(result.route.host, "demo.example.com");
  assert.equal(snapshot.routes.length, 1);
  assert.match(traefikConfig, /Host\(`demo\.example\.com`\)/);
  assert.match(traefikConfig, /http:\/\/zoneploy-demo-api:3000/);
});

test("route renderer emits an empty valid Traefik config", () => {
  assert.equal(renderTraefikDynamicConfig([]), "http:\n  routers: {}\n  services: {}\n");
});
