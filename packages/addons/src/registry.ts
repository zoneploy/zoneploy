import type { AddonManifest } from "@zoneploy/types";
import { firewallManagerManifest } from "./manifests/firewall-manager.js";

export const addonManifests = [firewallManagerManifest] as const;

export const listAddonManifests = (): AddonManifest[] => [...addonManifests];

export const findAddonManifest = (slug: string): AddonManifest | undefined => {
  return addonManifests.find((manifest) => manifest.slug === slug);
};
