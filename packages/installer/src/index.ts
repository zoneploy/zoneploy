export type InstallProfile = "standalone" | "paired";

export type SystemdServiceOptions = {
  serviceName: string;
  workingDirectory: string;
  command: string;
  environmentFile: string;
};

export const renderSystemdService = (options: SystemdServiceOptions): string => {
  return `[Unit]
Description=${options.serviceName}
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${options.workingDirectory}
EnvironmentFile=${options.environmentFile}
ExecStart=${options.command}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
};
