import { collectRuntimeServices, createAgentStatus } from "@zoneploy/runtime";
import type { AgentStatus } from "@zoneploy/types";
import { agentVersion } from "./version.js";

export const getAgentStatus = async (): Promise<AgentStatus> => {
  return createAgentStatus({
    agentVersion,
    mode: "standalone",
    capabilities: [],
    runtime: await collectRuntimeServices(),
  });
};
