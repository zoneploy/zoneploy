import {
  clearLocalStackRoutes,
  deployLocalStack,
  inspectStackService,
  listStackServices,
  removeLocalStack,
  runStackLifecycleAction,
  runStackServiceLifecycleAction,
  syncLocalStackRoutes,
} from "@zoneploy/runtime";
import type {
  LocalRouteClearResult,
  LocalRouteSyncResult,
  LocalStackDeployRequest,
  LocalStackDeployResult,
  LocalStackLifecycleAction,
  LocalStackLifecycleRequest,
  LocalStackRouteClearRequest,
  LocalStackRouteSyncRequest,
  LocalStackServiceLifecycleRequest,
  LocalStackServiceRuntime,
} from "@zoneploy/types";

export const runLocalStackDeploy = async (
  options: LocalStackDeployRequest,
): Promise<LocalStackDeployResult> => deployLocalStack(options);

export const getLocalStackServices = async (
  options: LocalStackLifecycleRequest,
): Promise<LocalStackServiceRuntime[]> => listStackServices(options);

export const runLocalStackAction = async (
  action: LocalStackLifecycleAction,
  options: LocalStackLifecycleRequest,
): Promise<void> => runStackLifecycleAction(action, options);

export const runLocalStackRemove = async (
  options: LocalStackLifecycleRequest,
): Promise<{ ok: boolean; removedRoutes: string[] }> => removeLocalStack(options);

export const runLocalStackServiceAction = async (
  action: LocalStackLifecycleAction,
  options: LocalStackServiceLifecycleRequest,
): Promise<void> => runStackServiceLifecycleAction(action, options);

export const inspectLocalStackService = async (
  options: LocalStackServiceLifecycleRequest,
): Promise<unknown> => inspectStackService(options);

export const syncLocalStackRuntimeRoutes = async (
  options: LocalStackRouteSyncRequest,
): Promise<LocalRouteSyncResult> => syncLocalStackRoutes(options);

export const clearLocalStackRuntimeRoutes = async (
  options: LocalStackRouteClearRequest,
): Promise<LocalRouteClearResult> => clearLocalStackRoutes(options);

