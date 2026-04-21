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
  runLocalDeploy,
  runLocalDeploymentAction,
  runLocalDeploymentRemove,
} from "./deployments.js";
import { getRouteSnapshot, runLocalRoute } from "./routes.js";
import { getAgentStatus } from "./status.js";
import { runLocalRollback } from "./rollback.js";

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
