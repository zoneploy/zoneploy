import type { AgentMode, AgentRuntimeConfig, CleanupPolicy } from "@zoneploy/types";

const readNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
};

const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

const readCleanupNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const readProfile = (value: string | undefined): AgentMode => {
  return value === "paired" ? "paired" : "standalone";
};

const optionalValue = (value: string | undefined): string | undefined => {
  return value && value.trim().length > 0 ? value : undefined;
};

export const loadCleanupPolicy = (env: NodeJS.ProcessEnv = process.env): CleanupPolicy => ({
  enabled: readBoolean(env.ZONEPLOY_CLEANUP_ENABLED, true),
  keepReleases: readCleanupNumber(env.ZONEPLOY_CLEANUP_KEEP_RELEASES, 5),
  keepDays: readCleanupNumber(env.ZONEPLOY_CLEANUP_KEEP_DAYS, 14),
  maxRegistryGb: readCleanupNumber(env.ZONEPLOY_CLEANUP_MAX_REGISTRY_GB, 20),
});

export const loadAgentRuntimeConfig = (
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeConfig => {
  const homeDir = optionalValue(env.ZONEPLOY_HOME) ?? "/opt/zoneploy";
  const configDir = optionalValue(env.ZONEPLOY_CONFIG_DIR) ?? "/etc/zoneploy/config";
  const dataDir = optionalValue(env.ZONEPLOY_DATA_DIR) ?? "/var/lib/zoneploy";
  const logsDir = optionalValue(env.ZONEPLOY_LOG_DIR) ?? "/var/log/zoneploy";
  const traefikDir = optionalValue(env.ZONEPLOY_TRAEFIK_DIR) ?? "/etc/zoneploy/traefik";

  return {
    profile: readProfile(env.ZONEPLOY_PROFILE),
    agentPort: readNumber(env.ZONEPLOY_AGENT_PORT ?? env.AGENT_PORT, 4000),
    registryPort: readNumber(env.ZONEPLOY_REGISTRY_PORT, 5000),
    registryHost: optionalValue(env.ZONEPLOY_REGISTRY_HOST) ?? "127.0.0.1",
    cleanupPolicy: loadCleanupPolicy(env),
    homeDir,
    sourceDir: optionalValue(env.ZONEPLOY_SOURCE_DIR) ?? `${homeDir}/source`,
    configDir,
    dataDir,
    logsDir,
    routesDir: optionalValue(env.ZONEPLOY_ROUTES_DIR) ?? "/etc/zoneploy/runtime-routes",
    registryDir: optionalValue(env.ZONEPLOY_REGISTRY_DIR) ?? `${dataDir}/registry`,
    registryConfigFile:
      optionalValue(env.ZONEPLOY_REGISTRY_CONFIG_FILE) ?? `${configDir}/registry.yml`,
    buildsDir: optionalValue(env.ZONEPLOY_BUILDS_DIR) ?? `${dataDir}/builds`,
    releasesDir: optionalValue(env.ZONEPLOY_RELEASES_DIR) ?? `${dataDir}/releases`,
    deploymentsDir: optionalValue(env.ZONEPLOY_DEPLOYMENTS_DIR) ?? `${dataDir}/deployments`,
    appsDir: optionalValue(env.ZONEPLOY_APPS_DIR) ?? `${dataDir}/apps`,
    traefikEnabled: readBoolean(env.ZONEPLOY_TRAEFIK_ENABLED, true),
    traefikHttpPort: readNumber(env.ZONEPLOY_TRAEFIK_HTTP_PORT, 80),
    traefikDir,
    traefikDynamicDir: optionalValue(env.ZONEPLOY_TRAEFIK_DYNAMIC_DIR) ?? `${traefikDir}/dynamic`,
    cloudUrl: optionalValue(env.ZONEPLOY_CLOUD_URL),
    instanceId: optionalValue(env.ZONEPLOY_INSTANCE_ID),
    pairingTokenSet: Boolean(optionalValue(env.ZONEPLOY_PAIRING_TOKEN)),
  };
};
