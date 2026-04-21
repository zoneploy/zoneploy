import { createRouteSnapshot, routeLocalDeployment } from "@zoneploy/runtime";
import type { LocalRouteRequest, LocalRouteResult, RouteSnapshot } from "@zoneploy/types";

export const getRouteSnapshot = async (): Promise<RouteSnapshot> => {
  return createRouteSnapshot();
};

export const runLocalRoute = async (options: LocalRouteRequest): Promise<LocalRouteResult> => {
  return routeLocalDeployment(options);
};
