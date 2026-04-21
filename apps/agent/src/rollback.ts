import { rollbackLocalDeployment } from "@zoneploy/runtime";
import type { LocalDeployResult, RollbackRequest } from "@zoneploy/types";

export const runLocalRollback = async (
  options: RollbackRequest,
): Promise<LocalDeployResult> => {
  return rollbackLocalDeployment(options);
};
