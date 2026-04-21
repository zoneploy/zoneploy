import type { LocalBuildRequest } from "./releases.js";
import type {
  DeploymentLifecycleAction,
  LocalDeploymentLogsRequest,
  LocalDeployRequest,
} from "./deployments.js";
import type { LocalRouteRequest } from "./routing.js";
import type { RollbackRequest } from "./releases.js";
import type { AgentStatus } from "./agent.js";
import type { RouteSnapshot } from "./routing.js";
import type { DeploymentSnapshot } from "./deployments.js";

export type CloudCommandAction =
  | { type: "status" }
  | { type: "routes" }
  | { type: "deployments" }
  | { type: "build"; input: LocalBuildRequest }
  | { type: "deploy"; input: LocalDeployRequest }
  | { type: "lifecycle"; action: DeploymentLifecycleAction; input: { deploymentName: string } }
  | { type: "logs"; input: LocalDeploymentLogsRequest }
  | { type: "remove"; input: { deploymentName: string } }
  | { type: "route"; input: LocalRouteRequest }
  | { type: "rollback"; input: RollbackRequest }
  | { type: "cleanup"; apply?: boolean };

export type CloudCommand = {
  id: string;
  action: CloudCommandAction;
  createdAt?: string;
};

export type CloudHeartbeatPayload = {
  generatedAt: string;
  agent: AgentStatus;
  routes: RouteSnapshot;
  deployments: DeploymentSnapshot;
};

export type CloudPollRequest = {
  instanceId: string;
  heartbeat: CloudHeartbeatPayload;
};

export type CloudPollResponse = {
  commands: CloudCommand[];
};

export type CloudCommandResultStatus = "succeeded" | "failed";

export type CloudCommandResult = {
  commandId: string;
  status: CloudCommandResultStatus;
  startedAt: string;
  finishedAt: string;
  output?: unknown;
  error?: string;
};
