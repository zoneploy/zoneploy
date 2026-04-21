import type { AddonManifest, AddonStatus } from "@zoneploy/types";

export type AddonContext = {
  dataDir: string;
  runtimeDir: string;
};

export type AddonModule = {
  manifest: AddonManifest;
  install(context: AddonContext): Promise<AddonStatus>;
  configure(context: AddonContext, config: Record<string, unknown>): Promise<AddonStatus>;
  uninstall(context: AddonContext): Promise<AddonStatus>;
  status(context: AddonContext): Promise<AddonStatus>;
};

export const createAddonManifest = (manifest: AddonManifest): AddonManifest => manifest;
