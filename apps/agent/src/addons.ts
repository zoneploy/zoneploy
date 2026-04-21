import { listAddonManifests } from "@zoneploy/addons";
import type { AddonManifest } from "@zoneploy/types";

export const listAvailableAddons = (): AddonManifest[] => {
  return listAddonManifests();
};
