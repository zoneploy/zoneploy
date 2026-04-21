import { createReleaseSnapshot } from "@zoneploy/runtime";
import type { ReleaseSnapshot } from "@zoneploy/types";

export const getReleaseSnapshot = async (appId?: string): Promise<ReleaseSnapshot> => {
  return createReleaseSnapshot(appId);
};
