import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  DeploymentSnapshot,
  DeploymentStatus,
  LocalDeployRequest,
  LocalDeployResult,
  LocalDeployment,
} from "@zoneploy/types";
import { runCommand } from "./commands.js";
import { loadAgentRuntimeConfig } from "./config.js";
import { readRelease } from "./releases.js";

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

export const createDeploymentSnapshot = async (): Promise<DeploymentSnapshot> => ({
  generatedAt: new Date().toISOString(),
  deployments: await listDeployments(),
});

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
