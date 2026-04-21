import { collectPreflightReport } from "@zoneploy/runtime";
import type { PreflightReport } from "@zoneploy/types";

export const getPreflightReport = async (): Promise<PreflightReport> => {
  return collectPreflightReport();
};
