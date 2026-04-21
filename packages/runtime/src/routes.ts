import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  LocalRouteRequest,
  LocalRouteResult,
  RouteDefinition,
  RouteSnapshot,
} from "@zoneploy/types";
import { loadAgentRuntimeConfig } from "./config.js";

const routeFileName = "route.json";
const traefikRoutesFileName = "zoneploy.yml";

const hostPattern =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;

const normalizeHost = (value: string): string => {
  const host = value.trim().toLowerCase().replace(/\.$/, "");

  if (!hostPattern.test(host)) {
    throw new Error("Host must be a valid DNS hostname.");
  }

  return host;
};

const routeSlug = (host: string): string => host.replace(/[^a-z0-9.-]+/g, "-");

const routesRoot = (): string => loadAgentRuntimeConfig().routesDir;

const traefikRoutesPath = (): string => {
  const config = loadAgentRuntimeConfig();
  return join(config.traefikDynamicDir, traefikRoutesFileName);
};

const routePath = (host: string): string => {
  return join(routesRoot(), routeSlug(normalizeHost(host)), routeFileName);
};

const routeDirectoryPath = (host: string): string => {
  return dirname(routePath(host));
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
};

const readRouteFile = async (path: string): Promise<RouteDefinition | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as RouteDefinition;
  } catch {
    return null;
  }
};

export const sortRoutes = (routes: RouteDefinition[]): RouteDefinition[] => {
  return [...routes].sort((left, right) => left.host.localeCompare(right.host));
};

export const listRoutes = async (): Promise<RouteDefinition[]> => {
  const root = routesRoot();
  const entries = await readdir(root).catch(() => []);
  const routes = await Promise.all(
    entries.map((entry) => readRouteFile(join(root, entry, routeFileName))),
  );

  return sortRoutes(routes.filter((route): route is RouteDefinition => route !== null));
};

export const createRouteSnapshot = async (): Promise<RouteSnapshot> => ({
  generatedAt: new Date().toISOString(),
  routes: await listRoutes(),
});

const escapeYamlString = (value: string): string => {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

const traefikResourceName = (route: RouteDefinition): string => {
  return `zoneploy-${routeSlug(route.host).replaceAll(".", "-")}`;
};

export const renderTraefikDynamicConfig = (routes: RouteDefinition[]): string => {
  const sortedRoutes = sortRoutes(routes);

  if (sortedRoutes.length === 0) {
    return "http:\n  routers: {}\n  services: {}\n";
  }

  const lines = ["http:", "  routers:"];

  for (const route of sortedRoutes) {
    const resourceName = traefikResourceName(route);
    lines.push(`    ${resourceName}:`);
    lines.push(`      rule: ${escapeYamlString(`Host(\`${route.host}\`)`)}`);
    lines.push("      entryPoints:");
    lines.push("        - web");
    lines.push(`      service: ${resourceName}`);
  }

  lines.push("  services:");

  for (const route of sortedRoutes) {
    const resourceName = traefikResourceName(route);
    const containerName = route.target.containerName;

    if (!containerName) {
      continue;
    }

    lines.push(`    ${resourceName}:`);
    lines.push("      loadBalancer:");
    lines.push("        servers:");
    lines.push(
      `          - url: ${escapeYamlString(`http://${containerName}:${route.target.port}`)}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

export const writeTraefikDynamicConfig = async (): Promise<string> => {
  const path = traefikRoutesPath();
  const routes = await listRoutes();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderTraefikDynamicConfig(routes), "utf8");
  return path;
};

export const removeRoutesForDeployment = async (
  deploymentName: string,
  containerName: string,
): Promise<string[]> => {
  const routes = await listRoutes();
  const removedHosts: string[] = [];

  for (const route of routes) {
    if (
      route.target.serviceName !== deploymentName &&
      route.target.containerName !== containerName
    ) {
      continue;
    }

    await rm(routeDirectoryPath(route.host), { recursive: true, force: true });
    removedHosts.push(route.host);
  }

  if (removedHosts.length > 0) {
    await writeTraefikDynamicConfig();
  }

  return removedHosts.sort();
};

export const routeLocalDeployment = async (
  request: LocalRouteRequest,
): Promise<LocalRouteResult> => {
  const { readDeployment } = await import("./deployments.js");
  const deployment = await readDeployment(request.deploymentName);

  if (!deployment || deployment.status !== "running") {
    throw new Error("A running deployment is required before routing.");
  }

  const host = normalizeHost(request.host);
  const route: RouteDefinition = {
    host,
    protocol: request.protocol ?? "http",
    source: request.source ?? "zoneploy-domain",
    target: {
      serviceName: deployment.name,
      containerName: deployment.containerName,
      port: deployment.containerPort,
    },
  };
  const path = routePath(host);

  await writeJsonFile(path, route);
  const traefikFile = await writeTraefikDynamicConfig();

  return {
    route,
    routeFile: path,
    traefikFile,
  };
};
