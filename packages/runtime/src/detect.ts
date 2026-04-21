import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import type {
  FirewallBackend,
  HostRuntimeInfo,
  PackageManager,
  RuntimeServiceSummary,
} from "@zoneploy/types";
import { commandExists, runCommand } from "./commands.js";
import { createRuntimePaths } from "./paths.js";

type OsRelease = {
  id: string | null;
  idLike: string[];
};

const parseOsRelease = (contents: string): OsRelease => {
  const values = new Map<string, string>();

  for (const line of contents.split("\n")) {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^"|"$/g, "");

    values.set(key, value);
  }

  return {
    id: values.get("ID") ?? null,
    idLike: (values.get("ID_LIKE") ?? "")
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean),
  };
};

const readOsRelease = async (): Promise<OsRelease> => {
  if (process.platform !== "linux") {
    return { id: null, idLike: [] };
  }

  try {
    return parseOsRelease(await readFile("/etc/os-release", "utf8"));
  } catch {
    return { id: null, idLike: [] };
  }
};

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export const detectPackageManager = async (): Promise<PackageManager> => {
  if (await commandExists("apt-get")) {
    return "apt";
  }

  if (await commandExists("dnf")) {
    return "dnf";
  }

  if (await commandExists("yum")) {
    return "yum";
  }

  if (await commandExists("apk")) {
    return "apk";
  }

  return "unknown";
};

export const detectFirewallBackend = async (): Promise<FirewallBackend> => {
  if (await commandExists("ufw")) {
    const status = await runCommand("ufw", ["status"], 5_000);

    if (/Status:\s+active/i.test(status.stdout)) {
      return "ufw";
    }
  }

  if (await commandExists("firewall-cmd")) {
    const status = await runCommand("firewall-cmd", ["--state"], 5_000);

    if (status.exitCode === 0 && status.stdout.trim() === "running") {
      return "firewalld";
    }
  }

  if (await commandExists("iptables")) {
    return "iptables";
  }

  return "unknown";
};

export const detectSystemd = async (): Promise<boolean> => {
  if (process.platform !== "linux") {
    return false;
  }

  return (await pathExists("/run/systemd/system")) && (await commandExists("systemctl"));
};

export const detectElevatedAccess = async (): Promise<"root" | "sudo" | "none"> => {
  if (process.platform !== "linux") {
    return "none";
  }

  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return "root";
  }

  if (await commandExists("sudo")) {
    return "sudo";
  }

  return "none";
};

export const detectDockerSnapInstall = async (): Promise<boolean> => {
  if (!(await commandExists("snap"))) {
    return false;
  }

  const result = await runCommand("snap", ["list", "docker"], 5_000);
  return result.exitCode === 0;
};

export const detectStorageMb = async (): Promise<number | null> => {
  if (process.platform !== "linux") {
    return null;
  }

  const result = await runCommand("df", ["-Pm", "/"], 5_000);

  if (result.exitCode !== 0) {
    return null;
  }

  const [, dataLine] = result.stdout.trim().split("\n");
  const columns = dataLine?.split(/\s+/) ?? [];
  const total = Number(columns[1]);

  return Number.isFinite(total) ? total : null;
};

export const detectHostRuntime = async (): Promise<HostRuntimeInfo> => {
  const osRelease = await readOsRelease();
  const elevatedAccess = await detectElevatedAccess();
  const totalMemoryMb = Math.round(os.totalmem() / 1024 / 1024);

  return {
    platform: process.platform === "linux" ? "linux" : "unknown",
    distroId: osRelease.id,
    distroLike: osRelease.idLike,
    kernel: process.platform === "linux" ? os.release() : null,
    arch: os.arch(),
    packageManager: await detectPackageManager(),
    firewallBackend: await detectFirewallBackend(),
    systemd: await detectSystemd(),
    rootAccess: elevatedAccess !== "none",
    elevatedAccess,
    dockerInstalled: await commandExists("docker"),
    dockerRunning: await isDockerRunning(),
    dockerSnapInstalled: await detectDockerSnapInstall(),
    totalCpuCores: os.cpus().length,
    totalMemoryMb,
    totalStorageMb: await detectStorageMb(),
  };
};

export const isDockerRunning = async (): Promise<boolean> => {
  if (!(await commandExists("docker"))) {
    return false;
  }

  const result = await runCommand("docker", ["info"], 10_000);
  return result.exitCode === 0;
};

export const collectRuntimeServices = async (): Promise<RuntimeServiceSummary[]> => {
  const dockerInstalled = await commandExists("docker");
  const dockerVersion = dockerInstalled
    ? (await runCommand("docker", ["--version"], 5_000)).stdout.trim()
    : undefined;
  const dockerRunning = dockerInstalled ? await isDockerRunning() : false;
  const traefik = await detectTraefikContainer();

  return [
    {
      name: "docker",
      status: dockerInstalled ? "installed" : "missing",
      version: dockerVersion || undefined,
    },
    {
      name: "docker-daemon",
      status: dockerRunning ? "running" : dockerInstalled ? "stopped" : "missing",
    },
    {
      name: "traefik",
      status: traefik.status,
      details: {
        dynamicFiles: traefik.dynamicFiles,
      },
    },
  ];
};

export const detectDockerComposeVersion = async (): Promise<string | null> => {
  if (!(await commandExists("docker"))) {
    return null;
  }

  const result = await runCommand("docker", ["compose", "version"], 5_000);
  return result.exitCode === 0 ? result.stdout.trim() : null;
};

export const detectTraefikContainer = async (): Promise<{
  status: "missing" | "stopped" | "running" | "unknown";
  dynamicFiles: string[];
}> => {
  if (!(await commandExists("docker"))) {
    return {
      status: "unknown",
      dynamicFiles: await listTraefikDynamicFiles(),
    };
  }

  const result = await runCommand(
    "docker",
    ["inspect", "--format", "{{.State.Status}}", "traefik"],
    5_000,
  );

  if (result.exitCode !== 0) {
    return {
      status: "missing",
      dynamicFiles: await listTraefikDynamicFiles(),
    };
  }

  const status = result.stdout.trim();

  return {
    status: status === "running" ? "running" : "stopped",
    dynamicFiles: await listTraefikDynamicFiles(),
  };
};

export const listTraefikDynamicFiles = async (): Promise<string[]> => {
  try {
    const entries = await readdir("/etc/traefik/dynamic", { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
};

export const getHostname = (): string => os.hostname();

export const getRuntimePaths = createRuntimePaths;
