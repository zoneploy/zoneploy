import type { LocalDeployResult, RollbackRequest } from "@zoneploy/types";
import {
  deployLocalRelease,
  normalizeLocalDeploymentName,
  readDeployment,
} from "./deployments.js";

export const rollbackLocalDeployment = async (
  request: RollbackRequest,
): Promise<LocalDeployResult> => {
  const deployment = await readDeployment(normalizeLocalDeploymentName(request.deploymentName));

  if (!deployment) {
    throw new Error("Deployment was not found.");
  }

  if (deployment.releaseId === request.releaseId) {
    return { deployment };
  }

  return deployLocalRelease({
    appId: deployment.appId,
    name: deployment.name,
    releaseId: request.releaseId,
    containerPort: deployment.containerPort,
    hostPort: deployment.hostPort,
  });
};
