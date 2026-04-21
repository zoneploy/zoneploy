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
