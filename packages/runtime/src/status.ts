import type {
  AgentMode,
  AgentStatus,
  RuntimeCapability,
  RuntimeServiceSummary,
} from "@zoneploy/types";

export type CreateAgentStatusInput = {
  agentVersion: string;
  mode: AgentMode;
  capabilities?: RuntimeCapability[];
  runtime?: RuntimeServiceSummary[];
};

export const createAgentStatus = (input: CreateAgentStatusInput): AgentStatus => ({
  generatedAt: new Date().toISOString(),
  agentVersion: input.agentVersion,
  mode: input.mode,
  health: "unknown",
  capabilities: input.capabilities ?? [],
  services: [],
  runtime: input.runtime ?? [],
});
