import { stat } from "node:fs/promises";
import type { RegistryStatus } from "@zoneploy/types";
import { runCommand } from "./commands.js";
import { loadAgentRuntimeConfig } from "./config.js";

const registryContainerName = "zoneploy-registry";

const readDirectorySizeMb = async (path: string): Promise<number | null> => {
  try {
    await stat(path);
  } catch {
    return null;
  }

  if (process.platform !== "linux") {
    return null;
  }

  const result = await runCommand("du", ["-sm", path], 10_000);

  if (result.exitCode !== 0) {
    return null;
  }

  const [size] = result.stdout.trim().split(/\s+/);
  const parsed = Number(size);

  return Number.isFinite(parsed) ? parsed : null;
};

export const collectLocalRegistryStatus = async (): Promise<RegistryStatus> => {
  const config = loadAgentRuntimeConfig();
  const inspect = await runCommand(
    "docker",
    ["inspect", "--format", "{{.State.Status}}", registryContainerName],
    5_000,
  );
  const dockerUnavailable =
    inspect.exitCode !== 0 && /executable file not found|ENOENT|not recognized/i.test(inspect.stderr);
  const rawStatus = inspect.exitCode === 0 ? inspect.stdout.trim() : null;

  return {
    enabled: true,
    host: config.registryHost,
    port: config.registryPort,
    url: `http://${config.registryHost}:${config.registryPort}`,
    containerName: registryContainerName,
    status: dockerUnavailable
      ? "unknown"
      : rawStatus === "running"
        ? "running"
        : rawStatus
          ? "stopped"
          : "missing",
    storagePath: config.registryDir,
    storageUsedMb: await readDirectorySizeMb(config.registryDir),
    cleanupPolicy: config.cleanupPolicy,
  };
};
