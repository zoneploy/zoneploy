import type { AgentMode, AgentRuntimeConfig } from "@zoneploy/types";

const readNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
};

const readProfile = (value: string | undefined): AgentMode => {
  return value === "paired" ? "paired" : "standalone";
};

const optionalValue = (value: string | undefined): string | undefined => {
  return value && value.trim().length > 0 ? value : undefined;
};

export const loadAgentRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeConfig => {
  const homeDir = optionalValue(env.ZONEPLOY_HOME) ?? "/opt/zoneploy";
  const configDir = optionalValue(env.ZONEPLOY_CONFIG_DIR) ?? "/etc/zoneploy/config";
  const dataDir = optionalValue(env.ZONEPLOY_DATA_DIR) ?? "/var/lib/zoneploy";
  const logsDir = optionalValue(env.ZONEPLOY_LOG_DIR) ?? "/var/log/zoneploy";

  return {
    profile: readProfile(env.ZONEPLOY_PROFILE),
    agentPort: readNumber(env.ZONEPLOY_AGENT_PORT ?? env.AGENT_PORT, 4000),
    homeDir,
    sourceDir: optionalValue(env.ZONEPLOY_SOURCE_DIR) ?? `${homeDir}/source`,
    configDir,
    dataDir,
    logsDir,
    cloudUrl: optionalValue(env.ZONEPLOY_CLOUD_URL),
    instanceId: optionalValue(env.ZONEPLOY_INSTANCE_ID),
    pairingTokenSet: Boolean(optionalValue(env.ZONEPLOY_PAIRING_TOKEN)),
  };
};
