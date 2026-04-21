import { collectAuditReport } from "@zoneploy/runtime";
import type { AuditReport } from "@zoneploy/types";
import { agentVersion } from "./version.js";

export const getAuditReport = async (): Promise<AuditReport> => {
  return collectAuditReport({ agentVersion });
};
