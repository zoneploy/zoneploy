import type { LocalBuildRequest } from "./releases.js";
import type {
  DeploymentLifecycleAction,
  LocalImageDeployRequest,
  LocalGitImageDeployRequest,
  LocalDeploymentLogsRequest,
  LocalDeployRequest,
} from "./deployments.js";
import type { LocalRouteClearRequest, LocalRouteRequest, LocalRouteSyncRequest } from "./routing.js";
import type { RollbackRequest } from "./releases.js";
import type { AgentStatus } from "./agent.js";
import type { RouteSnapshot } from "./routing.js";
import type { DeploymentSnapshot } from "./deployments.js";
import type {
  LocalStackDeployRequest,
  LocalGitStackDeployRequest,
  LocalStackLifecycleAction,
  LocalStackLifecycleRequest,
  LocalStackRouteClearRequest,
  LocalStackRouteSyncRequest,
  LocalStackServiceLifecycleRequest,
} from "./stacks.js";

export type CloudCommandAction =
  | { type: "status" }
  | { type: "routes" }
  | { type: "deployments" }
  | { type: "build"; input: LocalBuildRequest }
  | { type: "deploy"; input: LocalDeployRequest }
  | { type: "container.deploy"; input: LocalImageDeployRequest }
  | { type: "container.buildDeploy"; input: LocalGitImageDeployRequest }
  | { type: "container.lifecycle"; action: DeploymentLifecycleAction; input: { containerId: string } }
  | { type: "container.remove"; input: { containerId: string } }
  | { type: "container.routes.sync"; input: LocalRouteSyncRequest }
  | { type: "container.routes.clear"; input: LocalRouteClearRequest }
  | { type: "container.inspect"; input: { containerId: string } }
  | { type: "stack.deploy"; input: LocalStackDeployRequest }
  | { type: "stack.buildDeploy"; input: LocalGitStackDeployRequest }
  | { type: "stack.lifecycle"; action: LocalStackLifecycleAction; input: LocalStackLifecycleRequest }
  | { type: "stack.remove"; input: LocalStackLifecycleRequest }
  | { type: "stack.routes.sync"; input: LocalStackRouteSyncRequest }
  | { type: "stack.routes.clear"; input: LocalStackRouteClearRequest }
  | { type: "stack.services"; input: LocalStackLifecycleRequest }
  | { type: "stack.service.lifecycle"; action: LocalStackLifecycleAction; input: LocalStackServiceLifecycleRequest }
  | { type: "stack.service.inspect"; input: LocalStackServiceLifecycleRequest }
  | { type: "lifecycle"; action: DeploymentLifecycleAction; input: { deploymentName: string } }
  | { type: "logs"; input: LocalDeploymentLogsRequest }
  | { type: "remove"; input: { deploymentName: string } }
  | { type: "route"; input: LocalRouteRequest }
  | { type: "rollback"; input: RollbackRequest }
  | { type: "cleanup"; apply?: boolean }
  | { type: "audit" }
  | { type: "preflight" }
  | { type: "update" }
  | { type: "decommission" };

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
