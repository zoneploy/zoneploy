export type InstallProfile = "standalone" | "paired";

export type AgentInstallPaths = {
  homeDir: string;
  sourceDir: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  envFile: string;
};

export type AgentEnvironmentOptions = {
  profile: InstallProfile;
  agentPort: number;
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

  return {
    homeDir,
    sourceDir: `${homeDir}/source`,
    configDir,
    dataDir: "/var/lib/zoneploy",
    logsDir: "/var/log/zoneploy",
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
  const lines = [
    envLine("NODE_ENV", "production"),
    envLine("ZONEPLOY_PROFILE", options.profile),
    envLine("ZONEPLOY_AGENT_PORT", options.agentPort),
    envLine("ZONEPLOY_HOME", options.paths.homeDir),
    envLine("ZONEPLOY_SOURCE_DIR", options.paths.sourceDir),
    envLine("ZONEPLOY_CONFIG_DIR", options.paths.configDir),
    envLine("ZONEPLOY_DATA_DIR", options.paths.dataDir),
    envLine("ZONEPLOY_LOG_DIR", options.paths.logsDir),
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
