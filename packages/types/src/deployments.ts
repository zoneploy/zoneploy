export type DeploymentStatus = "running" | "stopped" | "failed" | "unknown";

export type LocalDeployRequest = {
  appId: string;
  releaseId?: string;
  name?: string;
  containerPort: number;
  hostPort?: number;
  env?: Record<string, string>;
};

export type LocalDeployment = {
  id: string;
  appId: string;
  name: string;
  releaseId: string;
  image: string;
  containerName: string;
  containerId?: string;
  containerPort: number;
  hostPort?: number;
  status: DeploymentStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type LocalDeployResult = {
  deployment: LocalDeployment;
};

export type DeploymentSnapshot = {
  generatedAt: string;
  deployments: LocalDeployment[];
};
