import { loadAgentRuntimeConfig } from "@zoneploy/runtime";
import type { PairingState } from "@zoneploy/types";

export const getPairingState = (): PairingState => {
  const config = loadAgentRuntimeConfig();
  const paired = config.profile === "paired" && Boolean(config.cloudUrl);

  return {
    paired,
    ...(config.cloudUrl ? { cloudUrl: config.cloudUrl } : {}),
    ...(config.instanceId ? { instanceId: config.instanceId } : {}),
  };
};
