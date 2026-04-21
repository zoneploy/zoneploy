import type { AgentStatus } from "@zoneploy/types";

export const createStandaloneStatus = (): AgentStatus => ({
  generatedAt: new Date().toISOString(),
  agentVersion: "0.0.0",
  mode: "standalone",
  health: "unknown",
  capabilities: [],
});
