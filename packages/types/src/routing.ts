export type RouteProtocol = "http" | "https";

export type RouteSource = "zoneploy-domain" | "custom-domain";

export type RouteTarget = {
  serviceName: string;
  containerName?: string;
  port: number;
};

export type RouteDefinition = {
  host: string;
  protocol: RouteProtocol;
  source: RouteSource;
  target: RouteTarget;
};

export type RouteSnapshot = {
  generatedAt: string;
  routes: RouteDefinition[];
};

export type LocalRouteRequest = {
  deploymentName: string;
  host: string;
  protocol?: RouteProtocol;
  source?: RouteSource;
};

export type LocalRoutePortMapping = {
  port: number;
  isPrimary: boolean;
  zoneploySubdomains: string[];
  customDomains: string[];
};

export type LocalRouteSyncRequest = {
  containerId: string;
  nameOrId: string;
  platformDomain: string;
  portMappings: LocalRoutePortMapping[];
};

export type LocalRouteClearRequest = {
  containerId: string;
  deploymentName?: string;
};

export type LocalRouteResult = {
  route: RouteDefinition;
  routeFile: string;
  traefikFile: string;
};

export type LocalRouteSyncResult = {
  routes: RouteDefinition[];
  traefikFile: string;
};

export type LocalRouteClearResult = {
  removedRoutes: string[];
};
