export type RuntimePaths = {
  baseDir: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  routesDir: string;
  addonsDir: string;
  traefikDir: string;
  traefikDynamicDir: string;
  registryDir: string;
  buildsDir: string;
  releasesDir: string;
  deploymentsDir: string;
  stacksDir: string;
  appsDir: string;
};

export const createRuntimePaths = (
  baseDir = "/etc/zoneploy",
  dataDir = "/var/lib/zoneploy",
): RuntimePaths => ({
  baseDir,
  configDir: `${baseDir}/config`,
  dataDir,
  logsDir: "/var/log/zoneploy",
  routesDir: `${baseDir}/runtime-routes`,
  addonsDir: `${baseDir}/addons`,
  traefikDir: `${baseDir}/traefik`,
  traefikDynamicDir: `${baseDir}/traefik/dynamic`,
  registryDir: `${dataDir}/registry`,
  buildsDir: `${dataDir}/builds`,
  releasesDir: `${dataDir}/releases`,
  deploymentsDir: `${dataDir}/deployments`,
  stacksDir: `${dataDir}/stacks`,
  appsDir: `${dataDir}/apps`,
});
