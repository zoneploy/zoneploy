import {
  clearLocalDeploymentRoutes,
  createRouteSnapshot,
  routeLocalDeployment,
  syncLocalDeploymentRoutes,
} from "@zoneploy/runtime";
import type {
  LocalRouteClearRequest,
  LocalRouteClearResult,
  LocalRouteRequest,
  LocalRouteResult,
  LocalRouteSyncRequest,
  LocalRouteSyncResult,
  RouteSnapshot,
} from "@zoneploy/types";

export const getRouteSnapshot = async (): Promise<RouteSnapshot> => {
  return createRouteSnapshot();
};

export const runLocalRoute = async (options: LocalRouteRequest): Promise<LocalRouteResult> => {
  return routeLocalDeployment(options);
};

export const syncLocalRoutes = async (options: LocalRouteSyncRequest): Promise<LocalRouteSyncResult> => {
  return syncLocalDeploymentRoutes(options);
};

export const clearLocalRoutes = async (options: LocalRouteClearRequest): Promise<LocalRouteClearResult> => {
  return clearLocalDeploymentRoutes(options);
};
