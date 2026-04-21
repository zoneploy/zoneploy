import { collectPreflightReport, loadAgentRuntimeConfig } from "@zoneploy/runtime";
import type { PreflightReport } from "@zoneploy/types";

export const getPreflightReport = async (): Promise<PreflightReport> => {
  const config = loadAgentRuntimeConfig();

  return collectPreflightReport({
    agentPort: config.agentPort,
  });
};
