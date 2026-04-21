export type AgentMode = "standalone" | "paired";

export type HealthState = "unknown" | "healthy" | "degraded" | "unhealthy";

export type AgentRuntimeConfig = {
  profile: AgentMode;
  agentPort: number;
  registryPort: number;
  registryHost: string;
  cleanupPolicy: CleanupPolicy;
  homeDir: string;
  sourceDir: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  registryDir: string;
  buildsDir: string;
  releasesDir: string;
  deploymentsDir: string;
  appsDir: string;
  cloudUrl?: string;
  instanceId?: string;
  pairingTokenSet: boolean;
};

export type CleanupPolicy = {
  enabled: boolean;
  keepReleases: number;
  keepDays: number;
  maxRegistryGb: number;
};

export type RegistryStatus = {
  enabled: boolean;
  host: string;
  port: number;
  url: string;
  containerName: string;
  status: RuntimeServiceStatus;
  storagePath: string;
  storageUsedMb: number | null;
  cleanupPolicy: CleanupPolicy;
};

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

export type RuntimeServiceStatus = "unknown" | "missing" | "installed" | "stopped" | "running";

export type RuntimeServiceSummary = {
  name: "docker" | "docker-daemon" | "traefik" | "local-registry";
  status: RuntimeServiceStatus;
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
  runtime: RuntimeServiceSummary[];
  registry?: RegistryStatus;
};
