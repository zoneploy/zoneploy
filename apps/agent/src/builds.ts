import { buildAndPushLocalImage } from "@zoneploy/runtime";
import type { LocalBuildRequest, LocalBuildResult } from "@zoneploy/types";

export type BuildCliOptions = LocalBuildRequest;

export const runLocalBuild = async (options: BuildCliOptions): Promise<LocalBuildResult> => {
  return buildAndPushLocalImage(options);
};
