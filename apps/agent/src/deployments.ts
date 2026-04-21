import { createDeploymentSnapshot, deployLocalRelease } from "@zoneploy/runtime";
import type { DeploymentSnapshot, LocalDeployRequest, LocalDeployResult } from "@zoneploy/types";

export const runLocalDeploy = async (
  options: LocalDeployRequest,
): Promise<LocalDeployResult> => {
  return deployLocalRelease(options);
};

export const getDeploymentSnapshot = async (): Promise<DeploymentSnapshot> => {
  return createDeploymentSnapshot();
};
