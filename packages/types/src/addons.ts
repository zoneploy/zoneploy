import type { HealthState, RuntimeCapability } from "./agent.js";

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
