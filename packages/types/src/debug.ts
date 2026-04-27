import type { RegistryStatus, RuntimeServiceSummary } from "./agent.js";
import type { AddonManifest } from "./addons.js";
import type { HostRuntimeInfo } from "./preflight.js";
import type { RouteSnapshot } from "./routing.js";

export type DebugReport = {
  generatedAt: string;
  agentVersion: string;
  hostname: string;
  host: HostRuntimeInfo;
  runtime: RuntimeServiceSummary[];
  registry: RegistryStatus;
  routes: RouteSnapshot;
  addons: AddonManifest[];
};
