import {
  createDeploymentSnapshot,
  buildAndDeployGitImage,
  deployExternalImage,
  deployLocalRelease,
  inspectLocalDeployment,
  readLocalDeploymentLogs,
  removeLocalDeployment,
  runDeploymentLifecycleAction,
} from "@zoneploy/runtime";
import type {
  DeploymentLifecycleAction,
  DeploymentSnapshot,
  LocalDeploymentActionRequest,
  LocalDeploymentActionResult,
  LocalDeploymentLogsRequest,
  LocalDeploymentLogsResult,
  LocalDeploymentRemoveResult,
  LocalDeployRequest,
  LocalDeployResult,
  LocalGitImageDeployRequest,
  LocalGitImageDeployResult,
  LocalImageDeployRequest,
  LocalImageDeployResult,
} from "@zoneploy/types";

export const runLocalDeploy = async (
  options: LocalDeployRequest,
): Promise<LocalDeployResult> => {
  return deployLocalRelease(options);
};

export const runLocalImageDeploy = async (
  options: LocalImageDeployRequest,
): Promise<LocalImageDeployResult> => {
  return deployExternalImage(options);
};

export const runLocalGitImageDeploy = async (
  options: LocalGitImageDeployRequest,
): Promise<LocalGitImageDeployResult> => {
  return buildAndDeployGitImage(options);
};

export const getDeploymentSnapshot = async (): Promise<DeploymentSnapshot> => {
  return createDeploymentSnapshot();
};

export const runLocalDeploymentAction = async (
  action: DeploymentLifecycleAction,
  options: LocalDeploymentActionRequest,
): Promise<LocalDeploymentActionResult> => {
  return runDeploymentLifecycleAction(action, options);
};

export const runLocalDeploymentRemove = async (
  options: LocalDeploymentActionRequest,
): Promise<LocalDeploymentRemoveResult> => {
  return removeLocalDeployment(options);
};

export const getLocalDeploymentLogs = async (
  options: LocalDeploymentLogsRequest,
): Promise<LocalDeploymentLogsResult> => {
  return readLocalDeploymentLogs(options);
};

export const inspectDeployment = async (nameOrId: string): Promise<unknown> => {
  return inspectLocalDeployment(nameOrId);
};
