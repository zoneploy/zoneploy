import type {
  AgentMode,
  AgentStatus,
  RegistryStatus,
  RuntimeCapability,
  RuntimeServiceSummary,
} from "@zoneploy/types";

export type CreateAgentStatusInput = {
  agentVersion: string;
  mode: AgentMode;
  capabilities?: RuntimeCapability[];
  runtime?: RuntimeServiceSummary[];
  registry?: RegistryStatus;
};

export const createAgentStatus = (input: CreateAgentStatusInput): AgentStatus => ({
  generatedAt: new Date().toISOString(),
  agentVersion: input.agentVersion,
  mode: input.mode,
  health: "unknown",
  capabilities: input.capabilities ?? [],
  services: [],
  runtime: input.runtime ?? [],
  ...(input.registry ? { registry: input.registry } : {}),
});
