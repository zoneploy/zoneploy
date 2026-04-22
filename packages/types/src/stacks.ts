import type { DeploymentLifecycleAction, LocalGitSource } from "./deployments.js";
import type { LocalRoutePortMapping } from "./routing.js";

export type StackDomainMapping = LocalRoutePortMapping & {
  id: string;
  serviceName: string;
};

export type LocalStackDeployRequest = {
  stackId: string;
  projectName: string;
  composeContent: string;
  envVars?: Record<string, string>;
  platformDomain?: string;
  domainMappings?: StackDomainMapping[];
  registryHost?: string;
  registryUser?: string;
  registryPassword?: string;
};

export type LocalGitStackSource = LocalGitSource & {
  composeFile?: string;
};

export type LocalGitStackDeployRequest = Omit<
  LocalStackDeployRequest,
  "composeContent" | "registryHost" | "registryUser" | "registryPassword"
> & {
  composeContent?: string;
  git: LocalGitStackSource;
  releaseId?: string;
};

export type LocalStackServiceRuntime = {
  serviceName: string;
  containerName: string;
  dockerId: string;
  status: string;
};

export type LocalStackDeployResult = {
  services: string[];
};

export type LocalGitStackDeployResult = LocalStackDeployResult & {
  releaseId: string;
  images: Record<string, string>;
};

export type LocalStackLifecycleRequest = {
  stackId: string;
  projectName: string;
};

export type LocalStackServiceLifecycleRequest = LocalStackLifecycleRequest & {
  serviceName: string;
};

export type LocalStackLifecycleAction = DeploymentLifecycleAction;

export type LocalStackRouteSyncRequest = {
  stackId: string;
  projectName: string;
  platformDomain: string;
  domainMappings: StackDomainMapping[];
};

export type LocalStackRouteClearRequest = {
  stackId: string;
  projectName: string;
};
