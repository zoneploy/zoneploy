import type { RuntimeServiceSummary } from "./agent.js";
import type { AddonManifest } from "./addons.js";
import type { HostRuntimeInfo } from "./preflight.js";
import type { PairingState } from "./pairing.js";
import type { RouteSnapshot } from "./routing.js";

export type DebugReport = {
  generatedAt: string;
  agentVersion: string;
  hostname: string;
  host: HostRuntimeInfo;
  runtime: RuntimeServiceSummary[];
  routes: RouteSnapshot;
  addons: AddonManifest[];
  pairing: PairingState;
};
