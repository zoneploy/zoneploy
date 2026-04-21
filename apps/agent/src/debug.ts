import { collectDebugReport } from "@zoneploy/runtime";
import type { DebugReport } from "@zoneploy/types";
import { agentVersion } from "./version.js";

export const getDebugReport = async (): Promise<DebugReport> => {
  return collectDebugReport({ agentVersion });
};
