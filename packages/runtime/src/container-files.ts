import { lstat, readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { runCommand } from "./commands.js";

export type ContainerFileEntry = {
  name: string;
  type: "file" | "dir" | "link";
  size: number;
  permissions: string;
};

type DockerInspectContainer = {
  GraphDriver?: {
    Data?: Record<string, string | undefined>;
  };
};

const normalizeContainerPath = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.includes("\0")) {
    throw new Error("Path must be an absolute container path.");
  }

  return trimmed.replace(/\/+/g, "/");
};

const modeToPermissions = (mode: number, type: ContainerFileEntry["type"]): string => {
  const typeChar = type === "dir" ? "d" : type === "link" ? "l" : "-";
  const flags: Array<[number, string]> = [
    [0o400, "r"],
    [0o200, "w"],
    [0o100, "x"],
    [0o040, "r"],
    [0o020, "w"],
    [0o010, "x"],
    [0o004, "r"],
    [0o002, "w"],
    [0o001, "x"],
  ];

  return `${typeChar}${flags.map(([bit, char]) => mode & bit ? char : "-").join("")}`;
};

const inspectContainer = async (reference: string): Promise<DockerInspectContainer> => {
  const inspect = await runCommand("docker", ["inspect", reference], {
    timeoutMs: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  if (inspect.exitCode !== 0) {
    throw new Error(inspect.stderr || inspect.stdout || "Docker inspect failed.");
  }

  const [container] = JSON.parse(inspect.stdout) as DockerInspectContainer[];
  if (!container) {
    throw new Error("Container not found.");
  }

  return container;
};

const mergedDirectory = (container: DockerInspectContainer): string => {
  const root = container.GraphDriver?.Data?.MergedDir;
  if (!root) {
    throw new Error("Container filesystem is not available for this Docker storage driver.");
  }

  return root;
};

const containerPathToHostPath = (root: string, containerPath: string): string => {
  const relativePath = normalizeContainerPath(containerPath).replace(/^\/+/, "");
  const rootPath = resolve(root);
  const hostPath = resolve(rootPath, relativePath);

  if (hostPath !== rootPath && !hostPath.startsWith(`${rootPath}${sep}`)) {
    throw new Error("Path escapes the container filesystem.");
  }

  return hostPath;
};

export const listDockerContainerFiles = async (
  reference: string,
  containerPath: string,
): Promise<ContainerFileEntry[]> => {
  const container = await inspectContainer(reference);
  const root = mergedDirectory(container);
  const hostPath = containerPathToHostPath(root, containerPath);
  const entries = await readdir(hostPath, { withFileTypes: true });

  const rows = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(hostPath, entry.name);
    const stats = await lstat(entryPath);
    const type: ContainerFileEntry["type"] = entry.isSymbolicLink()
      ? "link"
      : entry.isDirectory()
        ? "dir"
        : "file";

    return {
      name: entry.name,
      type,
      size: type === "dir" ? 0 : stats.size,
      permissions: modeToPermissions(stats.mode, type),
    };
  }));

  return rows.sort((left, right) => {
    if (left.type === "dir" && right.type !== "dir") return -1;
    if (left.type !== "dir" && right.type === "dir") return 1;
    return left.name.localeCompare(right.name);
  });
};
