import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type {
  LocalGitStackDeployRequest,
  LocalGitStackDeployResult,
  LocalStackDeployRequest,
  LocalStackDeployResult,
  LocalStackLifecycleAction,
  LocalStackLifecycleRequest,
  LocalStackServiceLifecycleRequest,
  LocalStackServiceRuntime,
} from "@zoneploy/types";
import { checkoutGitSource } from "./builds.js";
import { runCommand } from "./commands.js";
import { loadAgentRuntimeConfig } from "./config.js";
import { createLocalImageReference, createReleaseId } from "./releases.js";
import { removeRoutesForStack, syncLocalStackRoutes } from "./routes.js";

const safeIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

type DockerInspectContainer = {
  Id?: string;
  Name?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
  State?: {
    Status?: string;
  };
};

const assertSafeId = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!safeIdPattern.test(normalized)) {
    throw new Error(`${name} must be a safe identifier.`);
  }
  return normalized;
};

const stacksRoot = (): string => loadAgentRuntimeConfig().stacksDir;

const stackDirectory = (stackId: string): string => {
  return join(stacksRoot(), assertSafeId(stackId, "stackId"));
};

const composeFile = (stackId: string): string => join(stackDirectory(stackId), "docker-compose.yml");
const envFile = (stackId: string): string => join(stackDirectory(stackId), ".env");
const overrideFile = (stackId: string): string => join(stackDirectory(stackId), "zoneploy.override.yml");

const composeArgs = (request: LocalStackLifecycleRequest): string[] => [
  "compose",
  "--env-file",
  envFile(request.stackId),
  "-p",
  assertSafeId(request.projectName, "projectName"),
  "-f",
  composeFile(request.stackId),
  "-f",
  overrideFile(request.stackId),
];

const escapeEnvValue = (value: string): string => {
  return JSON.stringify(value);
};

const renderEnvFile = (envVars: Record<string, string>): string => {
  const lines = Object.entries(envVars)
    .filter(([key]) => envKeyPattern.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${escapeEnvValue(String(value))}`);

  return `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
};

const listDeclaredServices = (composeContent: string): string[] => {
  const services = new Set<string>();
  const lines = composeContent.replace(/\t/g, "  ").split(/\r?\n/);
  const servicesIndex = lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));

  if (servicesIndex < 0) {
    return [];
  }

  for (const line of lines.slice(servicesIndex + 1)) {
    if (/^\S/.test(line) && !/^#/.test(line)) {
      break;
    }

    const match = /^  ([a-zA-Z0-9._-]+):\s*(?:#.*)?$/.exec(line);
    if (match?.[1]) {
      services.add(match[1]);
    }
  }

  return Array.from(services).sort();
};

const renderOverrideFile = (services: string[]): string => {
  const lines = ["services:"];

  for (const service of services) {
    lines.push(`  ${service}:`);
    lines.push("    networks:");
    lines.push("      - default");
    lines.push("      - zoneploy");
  }

  lines.push("networks:");
  lines.push("  zoneploy:");
  lines.push("    external: true");

  return `${lines.join("\n")}\n`;
};

const renderImageOverrideFile = (images: Record<string, string>): string => {
  const lines = ["services:"];

  for (const [service, image] of Object.entries(images).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ${service}:`);
    lines.push(`    image: ${JSON.stringify(image)}`);
  }

  return `${lines.join("\n")}\n`;
};

const scalarToYaml = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(String(value));
};

const objectToYaml = (value: unknown, indent = 0): string => {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";

    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return `${pad}-\n${objectToYaml(item, indent + 2)}`;
        }

        return `${pad}- ${scalarToYaml(item)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";

    return entries
      .map(([key, item]) => {
        const safeKey = /^[A-Za-z0-9._-]+$/.test(key) ? key : JSON.stringify(key);

        if (Array.isArray(item)) {
          return item.length === 0
            ? `${pad}${safeKey}: []`
            : `${pad}${safeKey}:\n${objectToYaml(item, indent + 2)}`;
        }

        if (item && typeof item === "object") {
          return `${pad}${safeKey}:\n${objectToYaml(item, indent + 2)}`;
        }

        return `${pad}${safeKey}: ${scalarToYaml(item)}`;
      })
      .join("\n");
  }

  return `${pad}${scalarToYaml(value)}`;
};

const composeConfigAsJson = async (
  composePath: string,
  overridePath?: string,
): Promise<Record<string, unknown>> => {
  const args = ["compose", "-f", composePath];
  if (overridePath) {
    args.push("-f", overridePath);
  }
  args.push("config", "--format", "json");

  const result = await runCommand("docker", args, {
    cwd: dirname(composePath),
    timeoutMs: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Docker compose config failed.");
  }

  return JSON.parse(result.stdout) as Record<string, unknown>;
};

const buildableServicesFromCompose = async (composePath: string): Promise<string[]> => {
  const config = await composeConfigAsJson(composePath);
  const services = config.services;

  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("docker-compose.yml must declare services.");
  }

  return Object.entries(services as Record<string, unknown>)
    .filter(([, service]) => Boolean((service as { build?: unknown })?.build))
    .map(([service]) => service)
    .sort();
};

const cleanComposeContent = async (
  composePath: string,
  overridePath: string,
  buildableServices: string[],
): Promise<string> => {
  const config = await composeConfigAsJson(composePath, overridePath);
  const services = config.services;

  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("docker-compose.yml must declare services.");
  }

  for (const service of buildableServices) {
    const serviceConfig = (services as Record<string, Record<string, unknown>>)[service];
    if (serviceConfig) {
      delete serviceConfig.build;
    }
  }

  return `${objectToYaml(config)}\n`;
};

const imageRegistriesFromCompose = (composeContent: string): string[] => {
  const registries = new Set<string>();

  for (const line of composeContent.split(/\r?\n/)) {
    const match = /^\s*image:\s*['"]?([^'"\s#]+)['"]?/.exec(line);
    const image = match?.[1];
    if (!image || image.includes("${")) {
      continue;
    }

    const firstSegment = image.split("/")[0];
    if (
      firstSegment &&
      (firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost")
    ) {
      registries.add(firstSegment);
    }
  }

  return Array.from(registries).sort();
};

const loginRegistries = async (request: LocalStackDeployRequest): Promise<void> => {
  if (!request.registryUser || !request.registryPassword) {
    return;
  }

  const registries = new Set<string>();
  if (request.registryHost) {
    registries.add(request.registryHost);
  }
  for (const registry of imageRegistriesFromCompose(request.composeContent)) {
    registries.add(registry);
  }

  for (const registry of registries) {
    const login = await runCommand(
      "sh",
      [
        "-lc",
        `printf '%s' "$ZONEPLOY_REGISTRY_PASSWORD" | docker login ${JSON.stringify(registry)} -u ${JSON.stringify(request.registryUser)} --password-stdin`,
      ],
      {
        timeoutMs: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ZONEPLOY_REGISTRY_PASSWORD: request.registryPassword },
      },
    );

    if (login.exitCode !== 0) {
      throw new Error(login.stderr || login.stdout || `Docker login failed for ${registry}.`);
    }
  }
};

const ensureStackFiles = async (request: LocalStackDeployRequest): Promise<string[]> => {
  assertSafeId(request.stackId, "stackId");
  assertSafeId(request.projectName, "projectName");

  const services = listDeclaredServices(request.composeContent);
  if (services.length === 0) {
    throw new Error("docker-compose.yml must declare at least one service.");
  }

  const directory = stackDirectory(request.stackId);
  await mkdir(directory, { recursive: true });
  await writeFile(composeFile(request.stackId), `${request.composeContent.trim()}\n`, "utf8");
  await writeFile(envFile(request.stackId), renderEnvFile(request.envVars ?? {}), "utf8");
  await writeFile(overrideFile(request.stackId), renderOverrideFile(services), "utf8");

  return services;
};

const readComposeContent = async (stackId: string): Promise<string> => {
  return readFile(composeFile(stackId), "utf8");
};

const composeCommand = async (
  request: LocalStackLifecycleRequest,
  args: string[],
  timeoutMs = 5 * 60_000,
) => {
  const command = await runCommand("docker", [...composeArgs(request), ...args], {
    timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (command.exitCode !== 0) {
    throw new Error(command.stderr || command.stdout || `docker compose ${args.join(" ")} failed.`);
  }

  return command;
};

const inspectContainersByProject = async (projectName: string): Promise<DockerInspectContainer[]> => {
  const list = await runCommand(
    "docker",
    ["ps", "-aq", "--filter", `label=com.docker.compose.project=${projectName}`],
    30_000,
  );

  if (list.exitCode !== 0) {
    throw new Error(list.stderr || list.stdout || "Docker container listing failed.");
  }

  const ids = list.stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) {
    return [];
  }

  const inspect = await runCommand("docker", ["inspect", ...ids], {
    timeoutMs: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (inspect.exitCode !== 0) {
    throw new Error(inspect.stderr || inspect.stdout || "Docker inspect failed.");
  }

  return JSON.parse(inspect.stdout) as DockerInspectContainer[];
};

export const listStackServices = async (
  request: LocalStackLifecycleRequest,
): Promise<LocalStackServiceRuntime[]> => {
  const projectName = assertSafeId(request.projectName, "projectName");
  const containers = await inspectContainersByProject(projectName);

  return containers
    .map((container) => ({
      serviceName: container.Config?.Labels?.["com.docker.compose.service"] ?? "",
      containerName: (container.Name ?? "").replace(/^\//, ""),
      dockerId: container.Id ?? "",
      status: container.State?.Status ?? "unknown",
    }))
    .filter((service) => service.serviceName && service.containerName)
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
};

export const findStackServiceContainer = async (
  projectName: string,
  serviceName: string,
): Promise<LocalStackServiceRuntime | null> => {
  const services = await listStackServices({ stackId: "lookup", projectName });
  return services.find((service) => service.serviceName === serviceName) ?? null;
};

export const deployLocalStack = async (
  request: LocalStackDeployRequest,
): Promise<LocalStackDeployResult> => {
  const services = await ensureStackFiles(request);

  await runCommand("docker", ["network", "create", "zoneploy"], 30_000);
  await loginRegistries(request);

  await composeCommand(request, ["pull", "--ignore-pull-failures"], 10 * 60_000).catch(() => null);
  await composeCommand(request, ["up", "-d", "--remove-orphans"], 15 * 60_000);

  if (request.platformDomain && request.domainMappings) {
    await syncLocalStackRoutes({
      stackId: request.stackId,
      projectName: request.projectName,
      platformDomain: request.platformDomain,
      domainMappings: request.domainMappings,
    });
  }

  const runtimeServices = await listStackServices(request);
  return {
    services: runtimeServices.length > 0
      ? runtimeServices.map((service) => service.serviceName)
      : services,
  };
};

export const deployLocalGitStack = async (
  request: LocalGitStackDeployRequest,
): Promise<LocalGitStackDeployResult> => {
  const releaseId = request.releaseId ?? createReleaseId();
  const checkout = await checkoutGitSource(
    {
      ...request.git,
      contextPath: request.git.contextPath ?? ".",
    },
    releaseId,
  );
  const composePath = resolve(checkout.checkoutDir, request.git.composeFile ?? "docker-compose.yml");
  const relativeComposePath = relative(checkout.checkoutDir, composePath);

  if (relativeComposePath.startsWith("..") || resolve(relativeComposePath) === relativeComposePath) {
    throw new Error("git.composeFile must be inside the repository.");
  }

  await readFile(composePath, "utf8");

  const buildableServices = await buildableServicesFromCompose(composePath);
  const images: Record<string, string> = {};

  for (const service of buildableServices) {
    images[service] = createLocalImageReference({
      appId: `${request.stackId}-${service}`,
      releaseId,
    }).image;
  }

  let composeContent = request.composeContent;

  if (buildableServices.length > 0) {
    const overridePath = join(checkout.checkoutDir, ".zoneploy-images.override.yml");
    await writeFile(overridePath, renderImageOverrideFile(images), "utf8");

    const build = await runCommand(
      "docker",
      ["compose", "-f", composePath, "-f", overridePath, "build", ...buildableServices],
      {
        cwd: dirname(composePath),
        timeoutMs: 30 * 60_000,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    if (build.exitCode !== 0) {
      throw new Error(build.stderr || build.stdout || "Docker compose build failed.");
    }

    for (const image of Object.values(images)) {
      const push = await runCommand("docker", ["push", image], {
        timeoutMs: 10 * 60_000,
        maxBuffer: 16 * 1024 * 1024,
      });

      if (push.exitCode !== 0) {
        throw new Error(push.stderr || push.stdout || `Docker push failed for ${image}.`);
      }
    }

    composeContent = await cleanComposeContent(composePath, overridePath, buildableServices);
  } else if (!composeContent?.trim()) {
    composeContent = await readFile(composePath, "utf8");
  }

  const result = await deployLocalStack({
    stackId: request.stackId,
    projectName: request.projectName,
    composeContent,
    envVars: request.envVars,
    platformDomain: request.platformDomain,
    domainMappings: request.domainMappings,
  });

  return {
    ...result,
    releaseId,
    images,
  };
};

export const runStackLifecycleAction = async (
  action: LocalStackLifecycleAction,
  request: LocalStackLifecycleRequest,
): Promise<void> => {
  const dockerAction = action === "restart" ? "restart" : action;
  await composeCommand(request, [dockerAction]);
};

export const removeLocalStack = async (
  request: LocalStackLifecycleRequest,
): Promise<{ ok: boolean; removedRoutes: string[] }> => {
  await composeCommand(request, ["down", "--remove-orphans"], 5 * 60_000).catch(() => null);
  const removedRoutes = await removeRoutesForStack(request.stackId, request.projectName);
  await rm(dirname(composeFile(request.stackId)), { recursive: true, force: true });
  return { ok: true, removedRoutes };
};

export const runStackServiceLifecycleAction = async (
  action: LocalStackLifecycleAction,
  request: LocalStackServiceLifecycleRequest,
): Promise<void> => {
  assertSafeId(request.serviceName, "serviceName");
  const dockerAction = action === "restart" ? "restart" : action;
  await composeCommand(request, [dockerAction, request.serviceName]);
};

export const inspectStackService = async (
  request: LocalStackServiceLifecycleRequest,
): Promise<unknown> => {
  const service = await findStackServiceContainer(request.projectName, request.serviceName);
  if (!service) {
    throw new Error("Stack service was not found.");
  }

  const inspect = await runCommand("docker", ["inspect", service.containerName], {
    timeoutMs: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (inspect.exitCode !== 0) {
    throw new Error(inspect.stderr || inspect.stdout || "Docker inspect failed.");
  }

  return JSON.parse(inspect.stdout)[0] as unknown;
};

export const getDeclaredStackServices = async (stackId: string): Promise<string[]> => {
  return listDeclaredServices(await readComposeContent(stackId));
};
