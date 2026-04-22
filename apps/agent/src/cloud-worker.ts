import {
  loadAgentRuntimeConfig,
  pollCloudCommands,
  reportCloudCommandResult,
} from "@zoneploy/runtime";
import type {
  CloudCommand,
  CloudCommandResult,
  CloudHeartbeatPayload,
} from "@zoneploy/types";
import { runLocalBuild } from "./builds.js";
import { runLocalCleanup } from "./cleanup.js";
import {
  getDeploymentSnapshot,
  getLocalDeploymentLogs,
  inspectDeployment,
  runLocalDeploy,
  runLocalGitImageDeploy,
  runLocalImageDeploy,
  runLocalDeploymentAction,
  runLocalDeploymentRemove,
} from "./deployments.js";
import { clearLocalRoutes, getRouteSnapshot, runLocalRoute, syncLocalRoutes } from "./routes.js";
import { getAgentStatus } from "./status.js";
import { runLocalRollback } from "./rollback.js";
import { scheduleAgentOperation } from "./operations.js";
import {
  clearLocalStackRuntimeRoutes,
  getLocalStackServices,
  inspectLocalStackService,
  runLocalStackAction,
  runLocalGitStackDeploy,
  runLocalStackDeploy,
  runLocalStackRemove,
  runLocalStackServiceAction,
  syncLocalStackRuntimeRoutes,
} from "./stacks.js";

type WorkerHandle = {
  stop: () => void;
};

export type CloudSyncResult = {
  generatedAt: string;
  paired: boolean;
  commandCount: number;
  commandIds: string[];
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const createHeartbeat = async (): Promise<CloudHeartbeatPayload> => ({
  generatedAt: new Date().toISOString(),
  agent: await getAgentStatus(),
  routes: await getRouteSnapshot(),
  deployments: await getDeploymentSnapshot(),
});

const executeCloudCommand = async (command: CloudCommand): Promise<unknown> => {
  switch (command.action.type) {
    case "status":
      return getAgentStatus();
    case "routes":
      return getRouteSnapshot();
    case "deployments":
      return getDeploymentSnapshot();
    case "build":
      return runLocalBuild(command.action.input);
    case "deploy":
      return runLocalDeploy(command.action.input);
    case "container.deploy":
      return runLocalImageDeploy(command.action.input);
    case "container.buildDeploy":
      return runLocalGitImageDeploy(command.action.input);
    case "container.lifecycle":
      return runLocalDeploymentAction(command.action.action, {
        deploymentName: command.action.input.containerId,
      });
    case "container.remove":
      return runLocalDeploymentRemove({
        deploymentName: command.action.input.containerId,
      });
    case "container.routes.sync":
      return syncLocalRoutes(command.action.input);
    case "container.routes.clear":
      return clearLocalRoutes(command.action.input);
    case "container.inspect":
      return inspectDeployment(command.action.input.containerId);
    case "stack.deploy":
      return runLocalStackDeploy(command.action.input);
    case "stack.buildDeploy":
      return runLocalGitStackDeploy(command.action.input);
    case "stack.lifecycle":
      return runLocalStackAction(command.action.action, command.action.input);
    case "stack.remove":
      return runLocalStackRemove(command.action.input);
    case "stack.routes.sync":
      return syncLocalStackRuntimeRoutes(command.action.input);
    case "stack.routes.clear":
      return clearLocalStackRuntimeRoutes(command.action.input);
    case "stack.services":
      return getLocalStackServices(command.action.input);
    case "stack.service.lifecycle":
      return runLocalStackServiceAction(command.action.action, command.action.input);
    case "stack.service.inspect":
      return inspectLocalStackService(command.action.input);
    case "lifecycle":
      return runLocalDeploymentAction(command.action.action, command.action.input);
    case "logs":
      return getLocalDeploymentLogs(command.action.input);
    case "remove":
      return runLocalDeploymentRemove(command.action.input);
    case "route":
      return runLocalRoute(command.action.input);
    case "rollback":
      return runLocalRollback(command.action.input);
    case "cleanup":
      return runLocalCleanup(command.action.apply !== true);
    case "audit":
      return import("./audit.js").then((module) => module.getAuditReport());
    case "preflight":
      return import("./preflight.js").then((module) => module.getPreflightReport());
    case "update":
      return scheduleAgentOperation("update");
    case "decommission":
      return scheduleAgentOperation("uninstall");
  }
};

const runAndReportCommand = async (command: CloudCommand): Promise<void> => {
  const startedAt = new Date().toISOString();
  let result: CloudCommandResult;

  try {
    result = {
      commandId: command.id,
      status: "succeeded",
      startedAt,
      finishedAt: new Date().toISOString(),
      output: await executeCloudCommand(command),
    };
  } catch (error) {
    result = {
      commandId: command.id,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Command failed.",
    };
  }

  await reportCloudCommandResult(result);
};

export const runCloudCommandPollOnce = async (): Promise<CloudSyncResult> => {
  const config = loadAgentRuntimeConfig();

  if (config.profile !== "paired" || !config.cloudUrl || !config.instanceId || !config.agentToken) {
    throw new Error("Agent is not paired with Cloud.");
  }

  const response = await pollCloudCommands({
    instanceId: config.instanceId,
    heartbeat: await createHeartbeat(),
  });
  const commands = response.commands ?? [];

  for (const command of commands) {
    await runAndReportCommand(command);
  }

  return {
    generatedAt: new Date().toISOString(),
    paired: true,
    commandCount: commands.length,
    commandIds: commands.map((command) => command.id),
  };
};

export const startCloudCommandWorker = (): WorkerHandle => {
  const config = loadAgentRuntimeConfig();

  if (config.profile !== "paired" || !config.cloudUrl || !config.instanceId || !config.agentToken) {
    return { stop: () => undefined };
  }

  const pollIntervalMs = config.commandPollIntervalSeconds * 1000;
  let stopped = false;

  void (async () => {
    while (!stopped) {
      try {
        await runCloudCommandPollOnce();
      } catch (error) {
        console.warn(
          `Zoneploy cloud polling failed: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }

      await sleep(pollIntervalMs);
    }
  })();

  return {
    stop: () => {
      stopped = true;
    },
  };
};
