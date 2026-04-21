export type AgentMode = "standalone" | "paired";

export type HealthState = "unknown" | "healthy" | "degraded" | "unhealthy";

export type RuntimeCapability =
  | "linux-host"
  | "systemd"
  | "package-manager"
  | "docker"
  | "docker-daemon"
  | "traefik"
  | "firewall"
  | "backups";

export type AgentServiceStatus = {
  name: string;
  active: boolean;
  version?: string;
  details?: Record<string, unknown>;
};

export type AgentStatus = {
  generatedAt: string;
  agentVersion: string;
  mode: AgentMode;
  health: HealthState;
  capabilities: RuntimeCapability[];
  services: AgentServiceStatus[];
};
