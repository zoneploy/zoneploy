import { createAgentStatus } from "@zoneploy/runtime";
import type { AgentStatus } from "@zoneploy/types";
import { agentVersion } from "./version.js";

export const getAgentStatus = (): AgentStatus => {
  return createAgentStatus({
    agentVersion,
    mode: "standalone",
    capabilities: [],
  });
};
