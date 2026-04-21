import { listAvailableAddons } from "./addons.js";
import { getAuditReport } from "./audit.js";
import { runLocalBuild } from "./builds.js";
import { runLocalCleanup } from "./cleanup.js";
import {
  getDeploymentSnapshot,
  getLocalDeploymentLogs,
  runLocalDeploy,
  runLocalDeploymentAction,
  runLocalDeploymentRemove,
} from "./deployments.js";
import { getDebugReport } from "./debug.js";
import { runAgentOperation } from "./operations.js";
import { getPairingState, runPairing, runUnpairing } from "./pairing.js";
import { getPreflightReport } from "./preflight.js";
import { getReleaseSnapshot } from "./releases.js";
import { runLocalRollback } from "./rollback.js";
import { getRouteSnapshot, runLocalRoute } from "./routes.js";
import { startAgentServer } from "./server.js";
import { getAgentStatus } from "./status.js";

type AgentCommand =
  | "status"
  | "routes"
  | "addons"
  | "pairing"
  | "pair"
  | "unpair"
  | "preflight"
  | "debug"
  | "audit"
  | "build"
  | "cleanup"
  | "deploy"
  | "deployments"
  | "logs"
  | "remove"
  | "route"
  | "rollback"
  | "releases"
  | "serve"
  | "start"
  | "stop"
  | "restart"
  | "update"
  | "repair"
  | "uninstall";

const commands = new Set<AgentCommand>([
  "status",
  "routes",
  "addons",
  "pairing",
  "pair",
  "unpair",
  "preflight",
  "debug",
  "audit",
  "build",
  "cleanup",
  "deploy",
  "deployments",
  "logs",
  "remove",
  "route",
  "rollback",
  "releases",
  "serve",
  "start",
  "stop",
  "restart",
  "update",
  "repair",
  "uninstall",
]);

const isAgentCommand = (value: string): value is AgentCommand => {
  return commands.has(value as AgentCommand);
};

const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value, null, 2));
};

const readOption = (args: string[], names: string[]): string | undefined => {
  for (const name of names) {
    const index = args.indexOf(name);

    if (index >= 0) {
      return args[index + 1];
    }
  }

  return undefined;
};

const parseBuildOptions = (args: string[]) => {
  const appId = readOption(args, ["--app", "--app-id"]);
  const contextDir = readOption(args, ["--context", "--context-dir"]);

  if (!appId || !contextDir) {
    throw new Error(
      "Usage: zoneploy-agent build --app <app-id> --context <path> [--dockerfile <path>] [--release <id>]",
    );
  }

  return {
    appId,
    contextDir,
    dockerfile: readOption(args, ["--dockerfile"]),
    releaseId: readOption(args, ["--release", "--release-id"]),
  };
};

const parsePairOptions = (args: string[]) => {
  const cloudUrl = readOption(args, ["--cloud-url"]);
  const pairingToken = readOption(args, ["--token", "--pairing-token"]);

  if (!cloudUrl || !pairingToken) {
    throw new Error(
      "Usage: zoneploy-agent pair --cloud-url <url> --token <one-time-token> [--name <instance-name>]",
    );
  }

  return {
    cloudUrl,
    pairingToken,
    instanceName: readOption(args, ["--name", "--instance-name"]),
  };
};

const parsePort = (value: string | undefined, name: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }

  return parsed;
};

const parsePositiveInt = (value: string | undefined, name: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
};

const parseDeployOptions = (args: string[]) => {
  const appId = readOption(args, ["--app", "--app-id"]);
  const releaseId = readOption(args, ["--release", "--release-id"]);

  if (!appId || !releaseId) {
    throw new Error(
      "Usage: zoneploy-agent deploy --app <app-id> --release <id> --port <container-port> [--host-port <port>] [--name <name>]",
    );
  }

  return {
    appId,
    releaseId,
    name: readOption(args, ["--name"]),
    containerPort: parsePort(readOption(args, ["--port", "--container-port"]), "containerPort"),
    hostPort: readOption(args, ["--host-port"])
      ? parsePort(readOption(args, ["--host-port"]), "hostPort")
      : undefined,
  };
};

const parseRouteOptions = (args: string[]) => {
  const deploymentName = readOption(args, ["--deployment", "--name"]);
  const host = readOption(args, ["--host"]);

  if (!deploymentName || !host) {
    throw new Error(
      "Usage: zoneploy-agent route --deployment <name> --host <hostname>",
    );
  }

  return {
    deploymentName,
    host,
  };
};

const parseRollbackOptions = (args: string[]) => {
  const deploymentName = readOption(args, ["--deployment", "--name"]);
  const releaseId = readOption(args, ["--release", "--release-id"]);

  if (!deploymentName || !releaseId) {
    throw new Error(
      "Usage: zoneploy-agent rollback --deployment <name> --release <release-id>",
    );
  }

  return {
    deploymentName,
    releaseId,
  };
};

const parseDeploymentNameOptions = (
  args: string[],
  command: "logs" | "remove" | "restart" | "start" | "stop",
) => {
  const deploymentName = readOption(args, ["--deployment", "--name"]);

  if (!deploymentName) {
    throw new Error(`Usage: zoneploy-agent ${command} --deployment <name>`);
  }

  return { deploymentName };
};

const parseLogsOptions = (args: string[]) => {
  const options = parseDeploymentNameOptions(args, "logs");
  const tailValue = readOption(args, ["--tail"]);

  return {
    ...options,
    tail: tailValue ? parsePositiveInt(tailValue, "tail") : undefined,
  };
};

export const runCli = async (argv: string[]): Promise<number> => {
  const command = argv[2] ?? "status";

  if (!isAgentCommand(command)) {
    console.error(`Unknown command: ${command}`);
    console.error(
      "Available commands: status, routes, addons, pairing, pair, unpair, preflight, debug, audit, build, cleanup, deploy, deployments, logs, remove, route, rollback, releases, serve, start, stop, restart, update, repair, uninstall",
    );
    return 1;
  }

  switch (command) {
    case "status":
      printJson(await getAgentStatus());
      return 0;
    case "routes":
      printJson(await getRouteSnapshot());
      return 0;
    case "addons":
      printJson(listAvailableAddons());
      return 0;
    case "pairing":
      printJson(getPairingState());
      return 0;
    case "pair":
      try {
        printJson(await runPairing(parsePairOptions(argv.slice(3))));
        return 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Pairing failed.");
        return 1;
      }
    case "unpair":
      try {
        printJson(await runUnpairing());
        return 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Unpair failed.");
        return 1;
      }
    case "preflight":
      printJson(await getPreflightReport());
      return 0;
    case "debug":
      printJson(await getDebugReport());
      return 0;
    case "audit":
      printJson(await getAuditReport());
      return 0;
    case "build":
      try {
        const result = await runLocalBuild(parseBuildOptions(argv.slice(3)));
        printJson(result);
        return result.release.status === "ready" ? 0 : 1;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Build failed.");
        return 1;
      }
    case "cleanup":
      printJson(await runLocalCleanup(!argv.slice(3).includes("--apply")));
      return 0;
    case "deploy":
      try {
        const result = await runLocalDeploy(parseDeployOptions(argv.slice(3)));
        printJson(result);
        return result.deployment.status === "running" ? 0 : 1;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Deploy failed.");
        return 1;
      }
    case "rollback":
      try {
        const result = await runLocalRollback(parseRollbackOptions(argv.slice(3)));
        printJson(result);
        return result.deployment.status === "running" ? 0 : 1;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Rollback failed.");
        return 1;
      }
    case "deployments":
      printJson(await getDeploymentSnapshot());
      return 0;
    case "logs":
      try {
        printJson(await getLocalDeploymentLogs(parseLogsOptions(argv.slice(3))));
        return 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Logs failed.");
        return 1;
      }
    case "remove":
      try {
        const result = await runLocalDeploymentRemove(
          parseDeploymentNameOptions(argv.slice(3), "remove"),
        );
        printJson(result);
        return result.removed ? 0 : 1;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Remove failed.");
        return 1;
      }
    case "start":
    case "stop":
    case "restart":
      try {
        const result = await runLocalDeploymentAction(
          command,
          parseDeploymentNameOptions(argv.slice(3), command),
        );
        printJson(result);
        return result.deployment.status === "failed" ? 1 : 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : `${command} failed.`);
        return 1;
      }
    case "route":
      try {
        printJson(await runLocalRoute(parseRouteOptions(argv.slice(3))));
        return 0;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Route failed.");
        return 1;
      }
    case "releases":
      printJson(await getReleaseSnapshot(argv[3]));
      return 0;
    case "serve":
      return startAgentServer();
    case "update":
      return runAgentOperation("update", argv.slice(3));
    case "repair":
      return runAgentOperation("repair", argv.slice(3));
    case "uninstall":
      return runAgentOperation("uninstall", argv.slice(3));
  }
};
