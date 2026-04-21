export type RuntimePaths = {
  baseDir: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  routesDir: string;
  addonsDir: string;
  registryDir: string;
  buildsDir: string;
  releasesDir: string;
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
  registryDir: `${dataDir}/registry`,
  buildsDir: `${dataDir}/builds`,
  releasesDir: `${dataDir}/releases`,
  appsDir: `${dataDir}/apps`,
});
