import type { AuditCheck, AuditReport, AuditSection, AuditStatus } from "@zoneploy/types";
import {
  collectRuntimeServices,
  detectHostRuntime,
  getHostname,
} from "./detect.js";

export type CollectAuditReportInput = {
  agentVersion: string;
};

const check = (
  id: string,
  status: AuditStatus,
  title: string,
  message: string,
  details?: Record<string, unknown>,
): AuditCheck => ({
  id,
  status,
  title,
  message,
  ...(details ? { details } : {}),
});

const summarize = (sections: AuditSection[]): Record<AuditStatus, number> => {
  const summary: Record<AuditStatus, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
    info: 0,
  };

  for (const section of sections) {
    for (const auditCheck of section.checks) {
      summary[auditCheck.status] += 1;
    }
  }

  return summary;
};

export const collectAuditReport = async (
  input: CollectAuditReportInput,
): Promise<AuditReport> => {
  const runtime = await detectHostRuntime();
  const services = await collectRuntimeServices();
  const docker = services.find((service) => service.name === "docker");
  const dockerDaemon = services.find((service) => service.name === "docker-daemon");
  const traefik = services.find((service) => service.name === "traefik");
  const sections: AuditSection[] = [
    {
      title: "Host",
      checks: [
        check(
          "host.linux",
          runtime.platform === "linux" ? "pass" : "fail",
          "Linux host",
          runtime.platform === "linux" ? "Host is Linux." : "Zoneploy requires Linux.",
          { platform: runtime.platform },
        ),
        check(
          "host.rootAccess",
          runtime.rootAccess ? "pass" : "fail",
          "Root access",
          runtime.rootAccess
            ? `Elevated access is available through ${runtime.elevatedAccess}.`
            : "Root or passwordless sudo access is required.",
        ),
        check(
          "host.systemd",
          runtime.systemd ? "pass" : "fail",
          "systemd runtime",
          runtime.systemd ? "systemd is available." : "systemd is required.",
        ),
        check(
          "host.packageManager",
          runtime.packageManager === "unknown" ? "fail" : "pass",
          "Package manager",
          runtime.packageManager === "unknown"
            ? "No supported package manager was detected."
            : `Detected ${runtime.packageManager}.`,
        ),
      ],
    },
    {
      title: "Docker",
      checks: [
        check(
          "docker.installed",
          docker?.status === "installed" ? "pass" : "fail",
          "Docker CLI",
          docker?.status === "installed" ? "Docker CLI is installed." : "Docker CLI is missing.",
          { version: docker?.version ?? null },
        ),
        check(
          "docker.daemon",
          dockerDaemon?.status === "running" ? "pass" : "fail",
          "Docker daemon",
          dockerDaemon?.status === "running"
            ? "Docker daemon is reachable."
            : "Docker daemon is not reachable.",
        ),
        check(
          "docker.snap",
          runtime.dockerSnapInstalled ? "warn" : "pass",
          "Docker package source",
          runtime.dockerSnapInstalled
            ? "Docker appears to be installed through Snap."
            : "Docker does not appear to be installed through Snap.",
        ),
      ],
    },
    {
      title: "Routing",
      checks: [
        check(
          "traefik.container",
          traefik?.status === "running" ? "pass" : "warn",
          "Traefik container",
          traefik?.status === "running"
            ? "Traefik container is running."
            : "Traefik container is not running.",
          traefik?.details,
        ),
      ],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    hostname: getHostname(),
    agentVersion: input.agentVersion,
    sections,
    summary: summarize(sections),
  };
};
