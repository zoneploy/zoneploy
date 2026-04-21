import { cleanupLocalRuntime } from "@zoneploy/runtime";
import type { CleanupResult } from "@zoneploy/types";

export const runLocalCleanup = async (dryRun = false): Promise<CleanupResult> => {
  return cleanupLocalRuntime(dryRun);
};
