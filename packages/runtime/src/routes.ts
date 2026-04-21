import type { RouteDefinition, RouteSnapshot } from "@zoneploy/types";

export const createRouteSnapshot = (routes: RouteDefinition[] = []): RouteSnapshot => ({
  generatedAt: new Date().toISOString(),
  routes,
});

export const sortRoutes = (routes: RouteDefinition[]): RouteDefinition[] => {
  return [...routes].sort((left, right) => left.host.localeCompare(right.host));
};
