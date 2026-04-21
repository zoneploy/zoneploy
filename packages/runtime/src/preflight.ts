import type {
  HostCapabilities,
  PortStatus,
  PreflightConflict,
  PreflightReport,
} from "@zoneploy/types";
import { detectHostRuntime } from "./detect.js";
import { collectPortStatuses } from "./ports.js";

export type CollectPreflightReportOptions = {
  agentPort?: number;
  requiredPorts?: number[];
};

const defaultRequiredPorts = [80, 443];
const zoneployProcessPattern = /zoneploy-agent|apps\/agent\/dist\/index\.js|apps\\agent\\dist\\index\.js/;

const createConflict = (
  code: string,
  severity: "error" | "warning",
  message: string,
  details: Record<string, unknown> = {},
): PreflightConflict => ({
  code,
  severity,
  message,
  details,
});

const createCapabilities = (
  ports: PortStatus[],
  runtimeInfo: Awaited<ReturnType<typeof detectHostRuntime>>,
): HostCapabilities => {
  const portMap = Object.fromEntries(ports.map((port) => [String(port.port), port]));
  const packageManagerSupported = runtimeInfo.packageManager !== "unknown";

  return {
    linux: runtimeInfo.platform === "linux",
    rootAccess: runtimeInfo.rootAccess,
    systemd: runtimeInfo.systemd,
    packageManagerSupported,
    dockerInstalled: runtimeInfo.dockerInstalled,
    dockerRunning: runtimeInfo.dockerRunning,
    dockerSnapInstalled: runtimeInfo.dockerSnapInstalled,
    baseInstallReady:
      runtimeInfo.platform === "linux" &&
      runtimeInfo.rootAccess &&
      runtimeInfo.systemd &&
      packageManagerSupported &&
      !runtimeInfo.dockerSnapInstalled,
    ports: portMap,
  };
};

const isOwnedByZoneployAgent = (port: PortStatus): boolean => {
  if (port.listeners.length === 0) {
    return false;
  }

  return port.listeners.every((listener) => {
    const processName = listener.processName ?? "";
    const command = listener.command ?? "";

    return zoneployProcessPattern.test(processName) || zoneployProcessPattern.test(command);
  });
};

export const collectPreflightReport = async (
  options: CollectPreflightReportOptions = {},
): Promise<PreflightReport> => {
  const agentPort = options.agentPort ?? 4000;
  const portsToCheck = [...new Set([agentPort, ...(options.requiredPorts ?? defaultRequiredPorts)])].sort(
    (left, right) => left - right,
  );
  const runtimeInfo = await detectHostRuntime();
  const ports = await collectPortStatuses(portsToCheck);
  const capabilities = createCapabilities(ports, runtimeInfo);
  const conflicts: PreflightConflict[] = [];

  if (!capabilities.linux) {
    conflicts.push(
      createConflict("SERVER_OS_UNSUPPORTED", "error", "Zoneploy requires a Linux server."),
    );
  }

  if (!capabilities.rootAccess) {
    conflicts.push(
      createConflict(
        "SERVER_ROOT_ACCESS_REQUIRED",
        "error",
        "Root or passwordless sudo access is required.",
      ),
    );
  }

  if (!capabilities.systemd) {
    conflicts.push(
      createConflict("SERVER_SYSTEMD_REQUIRED", "error", "systemd is required to run the agent."),
    );
  }

  if (!capabilities.packageManagerSupported) {
    conflicts.push(
      createConflict(
        "SERVER_PACKAGE_MANAGER_UNSUPPORTED",
        "error",
        "Supported package managers are apt, dnf, yum and apk.",
      ),
    );
  }

  if (capabilities.dockerSnapInstalled) {
    conflicts.push(
      createConflict(
        "SERVER_DOCKER_SNAP_UNSUPPORTED",
        "warning",
        "Docker installed through Snap is not recommended for managed servers.",
      ),
    );
  }

  for (const port of ports) {
    if (!port.available) {
      if (port.port === agentPort && isOwnedByZoneployAgent(port)) {
        continue;
      }

      conflicts.push(
        createConflict(
          port.port === agentPort ? "AGENT_PORT_IN_USE" : `PORT_${port.port}_IN_USE`,
          port.port === agentPort ? "error" : "warning",
          `TCP port ${port.port} is already in use.`,
          { port: port.port, listeners: port.listeners },
        ),
      );
    }
  }

  const errors = conflicts.filter((conflict) => conflict.severity === "error").length;
  const warnings = conflicts.filter((conflict) => conflict.severity === "warning").length;

  return {
    checkedAt: new Date().toISOString(),
    remoteUser: process.env.USER ?? process.env.USERNAME ?? "unknown",
    runtimeInfo,
    capabilities,
    conflicts,
    ports,
    summary: {
      errors,
      warnings,
    },
  };
};
