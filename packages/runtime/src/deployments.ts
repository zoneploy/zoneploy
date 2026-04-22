import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DeploymentLifecycleAction,
  DeploymentSnapshot,
  DeploymentStatus,
  LocalDeploymentActionRequest,
  LocalDeploymentActionResult,
  LocalDeploymentLogsRequest,
  LocalDeploymentLogsResult,
  LocalDeploymentRemoveResult,
  LocalDeployRequest,
  LocalDeployResult,
  LocalImageDeployRequest,
  LocalImageDeployResult,
  LocalDeployment,
} from "@zoneploy/types";
import { runCommand } from "./commands.js";
import { loadAgentRuntimeConfig } from "./config.js";
import { readRelease } from "./releases.js";
import { removeRoutesForDeployment } from "./routes.js";

const deploymentFileName = "deployment.json";

const deploymentLabel = "zoneploy.managed=true";

const namePattern = /^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$|^[a-z0-9]$/;

const normalizeDeploymentName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/[._-]{2,}/g, "-");

  const result = normalized.length > 0 ? normalized.slice(0, 128) : "app";

  if (!namePattern.test(result)) {
    throw new Error("Deployment name must be Docker name-safe.");
  }

  return result;
};

const assertPort = (port: number, name: string): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
};

export const normalizeLocalDeploymentName = normalizeDeploymentName;

const deploymentsRoot = (): string => loadAgentRuntimeConfig().deploymentsDir;

const deploymentPath = (name: string): string => {
  return join(deploymentsRoot(), normalizeDeploymentName(name), deploymentFileName);
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
};

const readDeploymentFile = async (path: string): Promise<LocalDeployment | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as LocalDeployment;
  } catch {
    return null;
  }
};

export const saveDeployment = async (
  deployment: LocalDeployment,
): Promise<LocalDeployment> => {
  await writeJsonFile(deploymentPath(deployment.name), deployment);
  return deployment;
};

export const updateDeploymentStatus = async (
  deployment: LocalDeployment,
  status: DeploymentStatus,
  extra: Partial<LocalDeployment> = {},
): Promise<LocalDeployment> => {
  return saveDeployment({
    ...deployment,
    ...extra,
    status,
    updatedAt: new Date().toISOString(),
  });
};

export const readDeployment = async (name: string): Promise<LocalDeployment | null> => {
  return readDeploymentFile(deploymentPath(name));
};

export const findDeploymentByReference = async (
  value: string,
): Promise<LocalDeployment | null> => {
  const byName = await readDeployment(normalizeDeploymentName(value));
  if (byName) {
    return byName;
  }

  const deployments = await listDeployments();
  return deployments.find((deployment) => {
    return deployment.id === value
      || deployment.containerId === value
      || deployment.containerName === value
      || deployment.name === value;
  }) ?? null;
};

export const deleteDeploymentMetadata = async (name: string): Promise<void> => {
  await rm(dirname(deploymentPath(name)), { recursive: true, force: true });
};

export const listDeployments = async (): Promise<LocalDeployment[]> => {
  const root = deploymentsRoot();
  const entries = await readdir(root).catch(() => []);
  const deployments = await Promise.all(
    entries.map((entry) => readDeploymentFile(join(root, entry, deploymentFileName))),
  );

  return deployments
    .filter((deployment): deployment is LocalDeployment => deployment !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
};

const inspectContainerStatus = async (containerName: string): Promise<{
  status: DeploymentStatus;
  containerId?: string;
}> => {
  const result = await runCommand(
    "docker",
    ["inspect", "--format", "{{.Id}} {{.State.Status}}", containerName],
    5_000,
  );

  if (result.exitCode !== 0) {
    return { status: "unknown" };
  }

  const [containerId, rawStatus] = result.stdout.trim().split(/\s+/);

  return {
    status: rawStatus === "running" ? "running" : rawStatus === "exited" ? "stopped" : "unknown",
    containerId,
  };
};

const refreshDeploymentStatus = async (
  deployment: LocalDeployment,
): Promise<LocalDeployment> => {
  const inspected = await inspectContainerStatus(deployment.containerName);

  if (
    inspected.status === deployment.status &&
    inspected.containerId === deployment.containerId
  ) {
    return deployment;
  }

  return updateDeploymentStatus(deployment, inspected.status, {
    containerId: inspected.containerId,
    error: inspected.status === "unknown" ? deployment.error : undefined,
  });
};

export const createDeploymentSnapshot = async (): Promise<DeploymentSnapshot> => {
  const deployments = await listDeployments();
  const refreshed = await Promise.all(deployments.map(refreshDeploymentStatus));

  return {
    generatedAt: new Date().toISOString(),
    deployments: refreshed.sort((a, b) => a.name.localeCompare(b.name)),
  };
};

const readRequiredDeployment = async (deploymentName: string): Promise<LocalDeployment> => {
  const deployment = await findDeploymentByReference(deploymentName);

  if (!deployment) {
    throw new Error("Deployment was not found.");
  }

  return deployment;
};

export const runDeploymentLifecycleAction = async (
  action: DeploymentLifecycleAction,
  request: LocalDeploymentActionRequest,
): Promise<LocalDeploymentActionResult> => {
  const deployment = await readRequiredDeployment(request.deploymentName);
  const command = await runCommand("docker", [action, deployment.containerName], 60_000);
  const inspected = await inspectContainerStatus(deployment.containerName);

  if (command.exitCode !== 0) {
    return {
      deployment: await updateDeploymentStatus(deployment, inspected.status, {
        containerId: inspected.containerId,
        error: command.stderr || command.stdout || `Docker ${action} failed.`,
      }),
    };
  }

  return {
    deployment: await updateDeploymentStatus(deployment, inspected.status, {
      containerId: inspected.containerId,
      error: undefined,
    }),
  };
};

export const removeLocalDeployment = async (
  request: LocalDeploymentActionRequest,
): Promise<LocalDeploymentRemoveResult> => {
  const deployment = await readRequiredDeployment(request.deploymentName);
  const remove = await runCommand("docker", ["rm", "-f", deployment.containerName], 60_000);

  if (remove.exitCode !== 0) {
    return {
      deployment: await updateDeploymentStatus(deployment, "failed", {
        error: remove.stderr || remove.stdout || "Docker remove failed.",
      }),
      removed: false,
      removedRoutes: [],
    };
  }

  const removedRoutes = await removeRoutesForDeployment(
    deployment.name,
    deployment.containerName,
  );
  const removedDeployment = await updateDeploymentStatus(deployment, "stopped", {
    containerId: undefined,
    error: undefined,
  });

  await deleteDeploymentMetadata(deployment.name);

  return {
    deployment: removedDeployment,
    removed: true,
    removedRoutes,
  };
};

export const readLocalDeploymentLogs = async (
  request: LocalDeploymentLogsRequest,
): Promise<LocalDeploymentLogsResult> => {
  const deployment = await readRequiredDeployment(request.deploymentName);
  const tail = request.tail ?? 100;

  if (!Number.isInteger(tail) || tail < 1 || tail > 10_000) {
    throw new Error("tail must be between 1 and 10000.");
  }

  const logs = await runCommand(
    "docker",
    ["logs", "--tail", String(tail), deployment.containerName],
    {
      timeoutMs: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  if (logs.exitCode !== 0) {
    throw new Error(logs.stderr || logs.stdout || "Docker logs failed.");
  }

  return {
    generatedAt: new Date().toISOString(),
    deploymentName: deployment.name,
    containerName: deployment.containerName,
    tail,
    stdout: logs.stdout,
    stderr: logs.stderr,
  };
};

export const deployLocalRelease = async (
  request: LocalDeployRequest,
): Promise<LocalDeployResult> => {
  assertPort(request.containerPort, "containerPort");

  if (request.hostPort !== undefined) {
    assertPort(request.hostPort, "hostPort");
  }

  const releaseId = request.releaseId;

  if (!releaseId) {
    throw new Error("releaseId is required for local deploys.");
  }

  const release = await readRelease(request.appId, releaseId);

  if (!release || release.status !== "ready") {
    throw new Error("A ready release is required before deploy.");
  }

  const name = normalizeDeploymentName(request.name ?? request.appId);
  const containerName = `zoneploy-${name}`;
  const now = new Date().toISOString();
  const previous = await readDeployment(name);
  const initialDeployment: LocalDeployment = {
    id: previous?.id ?? name,
    appId: request.appId,
    name,
    releaseId,
    image: release.image,
    containerName,
    containerPort: request.containerPort,
    hostPort: request.hostPort,
    status: "unknown",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  await saveDeployment(initialDeployment);

  const pull = await runCommand("docker", ["pull", release.image], {
    timeoutMs: 10 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (pull.exitCode !== 0) {
    return {
      deployment: await updateDeploymentStatus(initialDeployment, "failed", {
        error: pull.stderr || pull.stdout || "Docker pull failed.",
      }),
    };
  }

  await runCommand("docker", ["rm", "-f", containerName], 60_000);

  const runArgs = [
    "run",
    "-d",
    "--name",
    containerName,
    "--restart",
    "unless-stopped",
    "--network",
    "zoneploy",
    "--label",
    deploymentLabel,
    "--label",
    `zoneploy.app=${request.appId}`,
    "--label",
    `zoneploy.release=${releaseId}`,
  ];

  if (request.hostPort !== undefined) {
    runArgs.push("-p", `${request.hostPort}:${request.containerPort}`);
  }

  for (const [key, value] of Object.entries(request.env ?? {})) {
    runArgs.push("-e", `${key}=${value}`);
  }

  runArgs.push(release.image);

  const run = await runCommand("docker", runArgs, {
    timeoutMs: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (run.exitCode !== 0) {
    return {
      deployment: await updateDeploymentStatus(initialDeployment, "failed", {
        error: run.stderr || run.stdout || "Docker run failed.",
      }),
    };
  }

  const inspected = await inspectContainerStatus(containerName);

  return {
    deployment: await updateDeploymentStatus(initialDeployment, inspected.status, {
      containerId: inspected.containerId,
      error: undefined,
    }),
  };
};

const registryFromImage = (image: string): string | null => {
  const firstSegment = image.split("/")[0];
  if (!firstSegment) {
    return null;
  }

  if (!firstSegment.includes(".") && !firstSegment.includes(":") && firstSegment !== "localhost") {
    return null;
  }

  return firstSegment;
};

const inspectImageDigest = async (image: string): Promise<string> => {
  const inspect = await runCommand(
    "docker",
    ["image", "inspect", "--format", "{{index .RepoDigests 0}}", image],
    10_000,
  );

  return inspect.exitCode === 0 && inspect.stdout.trim()
    ? inspect.stdout.trim()
    : image;
};

export const deployExternalImage = async (
  request: LocalImageDeployRequest,
): Promise<LocalImageDeployResult> => {
  assertPort(request.port, "port");

  const name = normalizeDeploymentName(request.containerId);
  const containerName = `zoneploy-${name}`;
  const now = new Date().toISOString();
  const previous = await readDeployment(name);
  const initialDeployment: LocalDeployment = {
    id: previous?.id ?? name,
    appId: request.containerId,
    name,
    releaseId: request.image,
    image: request.image,
    containerName,
    containerPort: request.port,
    status: "unknown",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };

  await saveDeployment(initialDeployment);

  if (request.registryUser && request.registryPassword) {
    const registry = registryFromImage(request.image);
    if (registry) {
      const login = await runCommand(
        "sh",
        ["-lc", `printf '%s' "$ZONEPLOY_REGISTRY_PASSWORD" | docker login ${JSON.stringify(registry)} -u ${JSON.stringify(request.registryUser)} --password-stdin`],
        {
          timeoutMs: 60_000,
          maxBuffer: 1024 * 1024,
          env: { ZONEPLOY_REGISTRY_PASSWORD: request.registryPassword },
        },
      );

      if (login.exitCode !== 0) {
        throw new Error(login.stderr || login.stdout || "Docker registry login failed.");
      }
    }
  }

  const pull = await runCommand("docker", ["pull", request.image], {
    timeoutMs: 10 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (pull.exitCode !== 0) {
    const failed = await updateDeploymentStatus(initialDeployment, "failed", {
      error: pull.stderr || pull.stdout || "Docker pull failed.",
    });
    throw new Error(failed.error ?? "Docker pull failed.");
  }

  await runCommand("docker", ["rm", "-f", containerName], 60_000);

  const runArgs = [
    "run",
    "-d",
    "--name",
    containerName,
    "--restart",
    "unless-stopped",
    "--network",
    "zoneploy",
    "--label",
    deploymentLabel,
    "--label",
    `zoneploy.containerId=${request.containerId}`,
  ];

  for (const [key, value] of Object.entries(request.envVars ?? {})) {
    runArgs.push("-e", `${key}=${value}`);
  }

  runArgs.push(request.image);

  const run = await runCommand("docker", runArgs, {
    timeoutMs: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (run.exitCode !== 0) {
    const failed = await updateDeploymentStatus(initialDeployment, "failed", {
      error: run.stderr || run.stdout || "Docker run failed.",
    });
    throw new Error(failed.error ?? "Docker run failed.");
  }

  const inspected = await inspectContainerStatus(containerName);
  const deployment = await updateDeploymentStatus(initialDeployment, inspected.status, {
    containerId: inspected.containerId,
    error: undefined,
  });

  if (request.platformDomain && request.portMappings) {
    const { syncLocalDeploymentRoutes } = await import("./routes.js");
    await syncLocalDeploymentRoutes({
      containerId: request.containerId,
      nameOrId: deployment.name,
      platformDomain: request.platformDomain,
      portMappings: request.portMappings,
    });
  }

  return {
    dockerId: deployment.containerId ?? run.stdout.trim(),
    imageDigest: await inspectImageDigest(request.image),
    containerName,
  };
};

export const inspectLocalDeployment = async (nameOrId: string): Promise<unknown> => {
  const deployment = await readRequiredDeployment(nameOrId);
  const inspect = await runCommand("docker", ["inspect", deployment.containerName], {
    timeoutMs: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (inspect.exitCode !== 0) {
    throw new Error(inspect.stderr || inspect.stdout || "Docker inspect failed.");
  }

  return JSON.parse(inspect.stdout) as unknown;
};
