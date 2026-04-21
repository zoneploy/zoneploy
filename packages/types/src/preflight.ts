export type PackageManager = "apt" | "dnf" | "yum" | "apk" | "unknown";

export type FirewallBackend = "ufw" | "firewalld" | "iptables" | "unknown";

export type ElevatedAccess = "root" | "sudo" | "none";

export type PortListener = {
  processName: string | null;
  pid: number | null;
};

export type PortStatus = {
  port: number;
  protocol: "tcp";
  available: boolean;
  listeners: PortListener[];
};

export type PreflightConflict = {
  code: string;
  severity: "error" | "warning";
  message: string;
  details: Record<string, unknown>;
};

export type HostRuntimeInfo = {
  platform: "linux" | "unknown";
  distroId: string | null;
  distroLike: string[];
  kernel: string | null;
  arch: string | null;
  packageManager: PackageManager;
  firewallBackend: FirewallBackend;
  systemd: boolean;
  rootAccess: boolean;
  elevatedAccess: ElevatedAccess;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  dockerSnapInstalled: boolean;
  totalCpuCores: number | null;
  totalMemoryMb: number | null;
  totalStorageMb: number | null;
};

export type HostCapabilities = {
  linux: boolean;
  rootAccess: boolean;
  systemd: boolean;
  packageManagerSupported: boolean;
  dockerInstalled: boolean;
  dockerRunning: boolean;
  dockerSnapInstalled: boolean;
  baseInstallReady: boolean;
  ports: Record<string, PortStatus>;
};

export type PreflightReport = {
  checkedAt: string;
  remoteUser: string;
  runtimeInfo: HostRuntimeInfo;
  capabilities: HostCapabilities;
  conflicts: PreflightConflict[];
  ports: PortStatus[];
  summary: {
    errors: number;
    warnings: number;
  };
};
