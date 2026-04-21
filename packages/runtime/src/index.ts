import type { AgentStatus, RuntimeCapability } from "@zoneploy/types";

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RouteSnapshot = {
  generatedAt: string;
  platformDomain?: string;
  hosts: Array<{
    host: string;
    targetPort: number;
    serviceName: string;
  }>;
};

export type RuntimeAdapter = {
  detectCapabilities(): Promise<RuntimeCapability[]>;
  getStatus(): Promise<AgentStatus>;
  getRoutes(): Promise<RouteSnapshot>;
};

export const createEmptyRouteSnapshot = (): RouteSnapshot => ({
  generatedAt: new Date().toISOString(),
  hosts: [],
});
