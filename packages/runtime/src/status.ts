import type { AgentMode, AgentStatus, RuntimeCapability } from "@zoneploy/types";

export type CreateAgentStatusInput = {
  agentVersion: string;
  mode: AgentMode;
  capabilities?: RuntimeCapability[];
};

export const createAgentStatus = (input: CreateAgentStatusInput): AgentStatus => ({
  generatedAt: new Date().toISOString(),
  agentVersion: input.agentVersion,
  mode: input.mode,
  health: "unknown",
  capabilities: input.capabilities ?? [],
  services: [],
});
