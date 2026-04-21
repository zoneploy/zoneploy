import {
  collectLocalRegistryStatus,
  collectRuntimeServices,
  createAgentStatus,
  loadAgentRuntimeConfig,
} from "@zoneploy/runtime";
import type { AgentStatus } from "@zoneploy/types";
import { agentVersion } from "./version.js";

export const getAgentStatus = async (): Promise<AgentStatus> => {
  const config = loadAgentRuntimeConfig();

  return createAgentStatus({
    agentVersion,
    mode: config.profile,
    capabilities: [],
    runtime: await collectRuntimeServices(),
    registry: await collectLocalRegistryStatus(),
  });
};
