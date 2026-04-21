export type AgentMode = "standalone" | "paired";
export type HealthState = "unknown" | "healthy" | "degraded" | "unhealthy";
export type RuntimeCapability = "linux-host" | "systemd" | "docker" | "docker-daemon" | "traefik" | "firewall" | "backups";
export type AgentStatus = {
    generatedAt: string;
    agentVersion: string;
    mode: AgentMode;
    health: HealthState;
    capabilities: RuntimeCapability[];
};
export type AddonCategory = "networking" | "security" | "storage" | "observability";
export type AddonPortRequirement = {
    port: number;
    protocol: "tcp" | "udp";
    reason: string;
    protected: boolean;
};
export type AddonManifest = {
    slug: string;
    name: string;
    category: AddonCategory;
    description: string;
    requiredCapabilities: RuntimeCapability[];
    ports: AddonPortRequirement[];
};
export type AddonStatus = {
    slug: string;
    installed: boolean;
    health: HealthState;
    version?: string;
    details?: Record<string, unknown>;
};
export type PairingState = {
    paired: boolean;
    cloudUrl?: string;
    instanceId?: string;
    pairedAt?: string;
};
//# sourceMappingURL=index.d.ts.map