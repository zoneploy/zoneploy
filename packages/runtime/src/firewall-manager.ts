import type { PackageManager } from "@zoneploy/types";
import { commandExists, runCommand } from "./commands.js";
import { detectFirewallBackend, detectPackageManager } from "./detect.js";

type FirewallBackendName = "ufw" | "firewalld" | "iptables";

type FirewallManagerConfig = {
  enabled?: boolean;
  allowedTcpPorts?: number[];
  protectedTcpPorts?: number[];
};

type FirewallBackendInfo = {
  name: "ufw" | "firewalld";
  packageName: string;
  serviceName: string;
  installed: boolean;
  active: boolean;
  recommended: boolean;
  canInstall: boolean;
  canUninstall: boolean;
};

const normalizePorts = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter((port): port is number =>
        typeof port === "number"
        && Number.isInteger(port)
        && port >= 1
        && port <= 65535,
      ),
    ),
  ).sort((left, right) => left - right);
};

const normalizeConfig = (config: Record<string, unknown>): Required<FirewallManagerConfig> => {
  const protectedTcpPorts = normalizePorts(config.protectedTcpPorts);
  const allowedTcpPorts = normalizePorts(config.allowedTcpPorts);

  return {
    enabled: config.enabled !== false,
    allowedTcpPorts: Array.from(new Set([...allowedTcpPorts, ...protectedTcpPorts])).sort((a, b) => a - b),
    protectedTcpPorts,
  };
};

const backendPackageName = (backend: "ufw" | "firewalld") => backend;
const backendServiceName = (backend: "ufw" | "firewalld") => backend;

const recommendedBackendForPackageManager = (packageManager: PackageManager): "ufw" | "firewalld" => {
  if (packageManager === "dnf" || packageManager === "yum") {
    return "firewalld";
  }

  return "ufw";
};

const isUfwActive = async () => {
  if (!(await commandExists("ufw"))) return false;
  const status = await runCommand("ufw", ["status"], 5_000);
  return /Status:\s+active/i.test(status.stdout);
};

const isFirewalldActive = async () => {
  if (!(await commandExists("firewall-cmd"))) return false;
  const status = await runCommand("firewall-cmd", ["--state"], 5_000);
  return status.exitCode === 0 && status.stdout.trim() === "running";
};

const assertCommandSucceeded = (result: { exitCode: number; stderr: string }, message: string) => {
  if (result.exitCode !== 0) {
    throw new Error(`${message}: ${result.stderr || "command failed"}`);
  }
};

const readBackendInfo = async (
  backend: "ufw" | "firewalld",
  packageManager: PackageManager,
): Promise<FirewallBackendInfo> => {
  const command = backend === "ufw" ? "ufw" : "firewall-cmd";
  const installed = await commandExists(command);
  const active = backend === "ufw" ? await isUfwActive() : await isFirewalldActive();
  const recommended = recommendedBackendForPackageManager(packageManager) === backend;

  return {
    name: backend,
    packageName: backendPackageName(backend),
    serviceName: backendServiceName(backend),
    installed,
    active,
    recommended,
    canInstall: !installed && packageManager !== "unknown",
    canUninstall: installed && !active && packageManager !== "unknown",
  };
};

const installPackage = async (packageManager: PackageManager, packageName: string) => {
  let result;
  if (packageManager === "apt") {
    await runCommand("apt-get", ["update"], { timeoutMs: 120_000, env: { DEBIAN_FRONTEND: "noninteractive" } });
    result = await runCommand("apt-get", ["install", "-y", "--no-install-recommends", packageName], {
      timeoutMs: 120_000,
      env: { DEBIAN_FRONTEND: "noninteractive" },
    });
  } else if (packageManager === "dnf") {
    result = await runCommand("dnf", ["install", "-y", packageName], 120_000);
  } else if (packageManager === "yum") {
    result = await runCommand("yum", ["install", "-y", packageName], 120_000);
  } else if (packageManager === "apk") {
    result = await runCommand("apk", ["add", "--no-cache", packageName], 120_000);
  } else {
    throw new Error("No supported package manager was detected.");
  }

  assertCommandSucceeded(result, `Failed to install ${packageName}`);
};

const removePackage = async (packageManager: PackageManager, packageName: string) => {
  let result;
  if (packageManager === "apt") {
    result = await runCommand("apt-get", ["remove", "-y", packageName], {
      timeoutMs: 120_000,
      env: { DEBIAN_FRONTEND: "noninteractive" },
    });
  } else if (packageManager === "dnf") {
    result = await runCommand("dnf", ["remove", "-y", packageName], 120_000);
  } else if (packageManager === "yum") {
    result = await runCommand("yum", ["remove", "-y", packageName], 120_000);
  } else if (packageManager === "apk") {
    result = await runCommand("apk", ["del", packageName], 120_000);
  } else {
    throw new Error("No supported package manager was detected.");
  }

  assertCommandSucceeded(result, `Failed to uninstall ${packageName}`);
};

const activeManagedBackend = async (): Promise<FirewallBackendName | null> => {
  if (await isUfwActive()) return "ufw";
  if (await isFirewalldActive()) return "firewalld";
  if (await commandExists("iptables")) return "iptables";
  return null;
};

const allowTcpPortWithBackend = async (backend: FirewallBackendName, port: number) => {
  if (backend === "ufw") {
    assertCommandSucceeded(await runCommand("ufw", ["allow", `${port}/tcp`], 15_000), `Failed to open TCP port ${port}`);
    return;
  }

  if (backend === "firewalld") {
    assertCommandSucceeded(await runCommand("firewall-cmd", ["--permanent", `--add-port=${port}/tcp`], 15_000), `Failed to open TCP port ${port}`);
    assertCommandSucceeded(await runCommand("firewall-cmd", ["--reload"], 15_000), "Failed to reload firewalld");
    return;
  }

  if (backend === "iptables") {
    const exists = await runCommand("iptables", ["-C", "INPUT", "-p", "tcp", "--dport", String(port), "-j", "ACCEPT"], 15_000);
    if (exists.exitCode !== 0) {
      assertCommandSucceeded(await runCommand("iptables", ["-I", "INPUT", "-p", "tcp", "--dport", String(port), "-j", "ACCEPT"], 15_000), `Failed to open TCP port ${port}`);
    }
    return;
  }
};

const applyAllowedTcpPortsIfBackendExists = async (ports: number[]) => {
  const backend = await activeManagedBackend();
  if (!backend) {
    return;
  }

  for (const port of ports) {
    await allowTcpPortWithBackend(backend, port);
  }
};

const primeBackendTcpPorts = async (backend: "ufw" | "firewalld", ports: number[]) => {
  if (backend === "ufw") {
    for (const port of ports) {
      await allowTcpPortWithBackend("ufw", port);
    }
    return;
  }

  if (await commandExists("firewall-offline-cmd")) {
    for (const port of ports) {
      assertCommandSucceeded(
        await runCommand("firewall-offline-cmd", [`--add-port=${port}/tcp`], 15_000),
        `Failed to preconfigure TCP port ${port}`,
      );
    }
  }
};

const closeTcpPort = async (port: number, protectedTcpPorts: number[]) => {
  if (protectedTcpPorts.includes(port)) {
    throw new Error(`TCP port ${port} is protected.`);
  }

  const backend = await activeManagedBackend();
  if (backend === "ufw") {
    assertCommandSucceeded(await runCommand("ufw", ["delete", "allow", `${port}/tcp`], 15_000), `Failed to close TCP port ${port}`);
    return;
  }

  if (backend === "firewalld") {
    assertCommandSucceeded(await runCommand("firewall-cmd", ["--permanent", `--remove-port=${port}/tcp`], 15_000), `Failed to close TCP port ${port}`);
    assertCommandSucceeded(await runCommand("firewall-cmd", ["--reload"], 15_000), "Failed to reload firewalld");
    return;
  }

  if (backend === "iptables") {
    await runCommand("iptables", ["-D", "INPUT", "-p", "tcp", "--dport", String(port), "-j", "ACCEPT"], 15_000);
    return;
  }

  throw new Error("No supported firewall backend is installed.");
};

const collectOpenTcpPorts = async (): Promise<number[]> => {
  if (await isUfwActive()) {
    const status = await runCommand("ufw", ["status"], 10_000);
    const ports = [...status.stdout.matchAll(/^(\d+)\/tcp\s+ALLOW\b/gim)].map(match => Number(match[1]));
    return normalizePorts(ports);
  }

  if (await isFirewalldActive()) {
    const ports = await runCommand("firewall-cmd", ["--list-ports"], 10_000);
    return normalizePorts([...ports.stdout.matchAll(/(\d+)\/tcp/g)].map(match => Number(match[1])));
  }

  if (await commandExists("iptables")) {
    const rules = await runCommand("iptables", ["-S", "INPUT"], 10_000);
    return normalizePorts([...rules.stdout.matchAll(/--dport\s+(\d+)/g)].map(match => Number(match[1])));
  }

  return [];
};

export const collectFirewallManagerHealth = async (configValue: Record<string, unknown>) => {
  const config = normalizeConfig(configValue);
  const packageManager = await detectPackageManager();
  const backends = await Promise.all([
    readBackendInfo("ufw", packageManager),
    readBackendInfo("firewalld", packageManager),
  ]);
  const activeBackend = await activeManagedBackend();
  const firewallBackend = await detectFirewallBackend();
  const openTcpPorts = await collectOpenTcpPorts();

  return {
    enabled: config.enabled,
    backends,
    managedTcpPorts: config.allowedTcpPorts,
    protectedTcpPorts: config.protectedTcpPorts,
    openTcpPorts,
    portUsages: config.protectedTcpPorts.map(port => ({
      port,
      protocol: "tcp",
      component: "Zoneploy access",
      description: "Required to keep SSH or the local agent reachable.",
      protected: true,
      severity: "critical",
    })),
    firewallBackend,
    activeBackend,
    recommendedBackend: recommendedBackendForPackageManager(packageManager),
    packageManager,
  };
};

export const applyFirewallManagerConfig = async (configValue: Record<string, unknown>) => {
  const config = normalizeConfig(configValue);
  if (config.enabled) {
    await applyAllowedTcpPortsIfBackendExists(config.allowedTcpPorts);
  }

  return {
    slug: "firewall-manager",
    status: "active" as const,
    version: null,
    config,
    capabilities: { firewall: true, tcpPortManagement: true },
    health: await collectFirewallManagerHealth(config),
  };
};

export const getFirewallManagerState = async (configValue: Record<string, unknown>) => ({
  slug: "firewall-manager",
  status: "active" as const,
  version: null,
  config: normalizeConfig(configValue),
  capabilities: { firewall: true, tcpPortManagement: true },
  health: await collectFirewallManagerHealth(configValue),
});

export const runFirewallManagerAction = async (
  action: string,
  payload: Record<string, unknown>,
  currentConfig: Record<string, unknown>,
) => {
  const packageManager = await detectPackageManager();
  const backend = typeof payload.backend === "string" ? payload.backend : "";
  const config = normalizeConfig(currentConfig);

  if (action === "install-backend") {
    if (backend !== "ufw" && backend !== "firewalld") throw new Error("Unsupported firewall backend.");
    await installPackage(packageManager, backendPackageName(backend));
  } else if (action === "activate-backend") {
    if (backend === "ufw") {
      await primeBackendTcpPorts("ufw", config.allowedTcpPorts);
      assertCommandSucceeded(await runCommand("ufw", ["--force", "enable"], 30_000), "Failed to activate UFW");
    } else if (backend === "firewalld") {
      await primeBackendTcpPorts("firewalld", config.allowedTcpPorts);
      assertCommandSucceeded(await runCommand("systemctl", ["enable", "--now", "firewalld"], 30_000), "Failed to activate firewalld");
      for (const port of config.allowedTcpPorts) {
        await allowTcpPortWithBackend("firewalld", port);
      }
    } else {
      throw new Error("Unsupported firewall backend.");
    }
  } else if (action === "deactivate-backend") {
    if (backend === "ufw") {
      assertCommandSucceeded(await runCommand("ufw", ["disable"], 30_000), "Failed to deactivate UFW");
    } else if (backend === "firewalld") {
      assertCommandSucceeded(await runCommand("systemctl", ["disable", "--now", "firewalld"], 30_000), "Failed to deactivate firewalld");
    } else {
      throw new Error("Unsupported firewall backend.");
    }
  } else if (action === "uninstall-backend") {
    if (backend !== "ufw" && backend !== "firewalld") throw new Error("Unsupported firewall backend.");
    const backendInfo = await readBackendInfo(backend, packageManager);
    if (backendInfo.active) throw new Error("Deactivate this firewall backend before uninstalling it.");
    await removePackage(packageManager, backendPackageName(backend));
  } else if (action === "close-port") {
    const port = typeof payload.port === "number" ? payload.port : null;
    const protectedTcpPorts = normalizePorts(payload.protectedTcpPorts).length > 0
      ? normalizePorts(payload.protectedTcpPorts)
      : config.protectedTcpPorts;
    if (!port) throw new Error("A valid TCP port is required.");
    await closeTcpPort(port, protectedTcpPorts);
    config.allowedTcpPorts = config.allowedTcpPorts.filter(entry => entry !== port);
  } else {
    throw new Error("Unsupported firewall action.");
  }

  return {
    slug: "firewall-manager",
    status: "active" as const,
    version: null,
    config,
    capabilities: { firewall: true, tcpPortManagement: true },
    health: await collectFirewallManagerHealth(config),
  };
};
