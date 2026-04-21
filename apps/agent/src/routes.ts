import { createRouteSnapshot } from "@zoneploy/runtime";
import type { RouteSnapshot } from "@zoneploy/types";

export const getRouteSnapshot = (): RouteSnapshot => {
  return createRouteSnapshot();
};
