export type RuntimePaths = {
  baseDir: string;
  configDir: string;
  dataDir: string;
  logsDir: string;
  routesDir: string;
  addonsDir: string;
};

export const createRuntimePaths = (baseDir = "/etc/zoneploy"): RuntimePaths => ({
  baseDir,
  configDir: `${baseDir}/config`,
  dataDir: `${baseDir}/data`,
  logsDir: `${baseDir}/logs`,
  routesDir: `${baseDir}/runtime-routes`,
  addonsDir: `${baseDir}/addons`,
});
