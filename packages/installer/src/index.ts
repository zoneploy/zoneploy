export type InstallProfile = "standalone" | "paired";

export type AgentInstallPaths = {
  homeDir: string;
  sourceDir: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  routesDir: string;
  registryDir: string;
  buildsDir: string;
  releasesDir: string;
  deploymentsDir: string;
  appsDir: string;
  traefikDir: string;
  traefikDynamicDir: string;
  envFile: string;
};

export type CleanupPolicyOptions = {
  enabled: boolean;
  keepReleases: number;
  keepDays: number;
  maxRegistryGb: number;
};

export type AgentEnvironmentOptions = {
  profile: InstallProfile;
  agentPort: number;
  registryHost?: string;
  registryPort?: number;
  cleanupPolicy?: CleanupPolicyOptions;
  paths: AgentInstallPaths;
  cloudUrl?: string;
  pairingToken?: string;
  instanceId?: string;
};

export type SystemdServiceOptions = {
  serviceName: string;
  workingDirectory: string;
  command: string;
  environmentFile: string;
  description?: string;
};

export const createDefaultInstallPaths = (homeDir = "/opt/zoneploy"): AgentInstallPaths => {
  const configDir = "/etc/zoneploy/config";
  const dataDir = "/var/lib/zoneploy";

  return {
    homeDir,
    sourceDir: `${homeDir}/source`,
    configDir,
    dataDir,
    logsDir: "/var/log/zoneploy",
    routesDir: "/etc/zoneploy/runtime-routes",
    registryDir: `${dataDir}/registry`,
    buildsDir: `${dataDir}/builds`,
    releasesDir: `${dataDir}/releases`,
    deploymentsDir: `${dataDir}/deployments`,
    appsDir: `${dataDir}/apps`,
    traefikDir: "/etc/zoneploy/traefik",
    traefikDynamicDir: "/etc/zoneploy/traefik/dynamic",
    envFile: `${configDir}/agent.env`,
  };
};

const quoteEnvValue = (value: string | number): string => {
  const text = String(value);

  if (/^[A-Za-z0-9_./:@-]+$/.test(text)) {
    return text;
  }

  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
};

const envLine = (key: string, value: string | number | undefined): string | null => {
  if (value === undefined || value === "") {
    return null;
  }

  return `${key}=${quoteEnvValue(value)}`;
};

export const renderAgentEnvironment = (options: AgentEnvironmentOptions): string => {
  const cleanupPolicy = options.cleanupPolicy ?? {
    enabled: true,
    keepReleases: 5,
    keepDays: 14,
    maxRegistryGb: 20,
  };

  const lines = [
    envLine("NODE_ENV", "production"),
    envLine("ZONEPLOY_PROFILE", options.profile),
    envLine("ZONEPLOY_AGENT_PORT", options.agentPort),
    envLine("ZONEPLOY_REGISTRY_HOST", options.registryHost ?? "127.0.0.1"),
    envLine("ZONEPLOY_REGISTRY_PORT", options.registryPort ?? 5000),
    envLine("ZONEPLOY_HOME", options.paths.homeDir),
    envLine("ZONEPLOY_SOURCE_DIR", options.paths.sourceDir),
    envLine("ZONEPLOY_CONFIG_DIR", options.paths.configDir),
    envLine("ZONEPLOY_DATA_DIR", options.paths.dataDir),
    envLine("ZONEPLOY_LOG_DIR", options.paths.logsDir),
    envLine("ZONEPLOY_ROUTES_DIR", options.paths.routesDir),
    envLine("ZONEPLOY_REGISTRY_DIR", options.paths.registryDir),
    envLine("ZONEPLOY_BUILDS_DIR", options.paths.buildsDir),
    envLine("ZONEPLOY_RELEASES_DIR", options.paths.releasesDir),
    envLine("ZONEPLOY_DEPLOYMENTS_DIR", options.paths.deploymentsDir),
    envLine("ZONEPLOY_APPS_DIR", options.paths.appsDir),
    envLine("ZONEPLOY_TRAEFIK_ENABLED", "true"),
    envLine("ZONEPLOY_TRAEFIK_HTTP_PORT", 80),
    envLine("ZONEPLOY_TRAEFIK_DIR", options.paths.traefikDir),
    envLine("ZONEPLOY_TRAEFIK_DYNAMIC_DIR", options.paths.traefikDynamicDir),
    envLine("ZONEPLOY_CLEANUP_ENABLED", String(cleanupPolicy.enabled)),
    envLine("ZONEPLOY_CLEANUP_KEEP_RELEASES", cleanupPolicy.keepReleases),
    envLine("ZONEPLOY_CLEANUP_KEEP_DAYS", cleanupPolicy.keepDays),
    envLine("ZONEPLOY_CLEANUP_MAX_REGISTRY_GB", cleanupPolicy.maxRegistryGb),
    envLine("ZONEPLOY_CLOUD_URL", options.cloudUrl),
    envLine("ZONEPLOY_PAIRING_TOKEN", options.pairingToken),
    envLine("ZONEPLOY_INSTANCE_ID", options.instanceId),
  ].filter((line): line is string => line !== null);

  return `${lines.join("\n")}\n`;
};

export const renderSystemdService = (options: SystemdServiceOptions): string => {
  return `[Unit]
Description=${options.description ?? options.serviceName}
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=root
WorkingDirectory=${options.workingDirectory}
EnvironmentFile=${options.environmentFile}
ExecStart=${options.command}
Restart=always
RestartSec=5
StartLimitIntervalSec=120
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${options.serviceName}

[Install]
WantedBy=multi-user.target
`;
};

export const renderCommandShim = (sourceDir: string, envFile: string): string => {
  return `#!/usr/bin/env sh
set -a
[ -f "${envFile}" ] && . "${envFile}"
set +a
exec node "${sourceDir}/apps/agent/dist/index.js" "$@"
`;
};

export type OperationCommand = "update" | "repair" | "uninstall";

export const renderOperationShim = (
  sourceDir: string,
  envFile: string,
  command: OperationCommand,
): string => {
  return `#!/usr/bin/env sh
set -eu
set -a
[ -f "${envFile}" ] && . "${envFile}"
set +a
unset NODE_ENV
export PNPM_CONFIG_PROD=false
tmp="$(mktemp /tmp/zoneploy-install.XXXXXX)"
cp "${sourceDir}/install.sh" "$tmp"
set +e
bash "$tmp" ${command} "$@"
status="$?"
set -e
rm -f "$tmp"
exit "$status"
`;
};
