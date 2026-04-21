import type { DebugReport } from "@zoneploy/types";
import { detectHostRuntime, getHostname, collectRuntimeServices } from "./detect.js";
import { createRouteSnapshot } from "./routes.js";

export type CollectDebugReportInput = {
  agentVersion: string;
};

export const collectDebugReport = async (
  input: CollectDebugReportInput,
): Promise<DebugReport> => ({
  generatedAt: new Date().toISOString(),
  agentVersion: input.agentVersion,
  hostname: getHostname(),
  host: await detectHostRuntime(),
  runtime: await collectRuntimeServices(),
  routes: createRouteSnapshot(),
  addons: [],
  pairing: {
    paired: false,
  },
});
