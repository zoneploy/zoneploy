import { listAvailableAddons } from "./addons.js";
import { getAuditReport } from "./audit.js";
import { runLocalBuild } from "./builds.js";
import { getDeploymentSnapshot, runLocalDeploy } from "./deployments.js";
import { getDebugReport } from "./debug.js";
import { runAgentOperation } from "./operations.js";
import { getPairingState } from "./pairing.js";
import { getPreflightReport } from "./preflight.js";
import { getReleaseSnapshot } from "./releases.js";
import { getRouteSnapshot } from "./routes.js";
import { startAgentServer } from "./server.js";
import { getAgentStatus } from "./status.js";

type AgentCommand =
  | "status"
  | "routes"
  | "addons"
  | "pairing"
  | "preflight"
  | "debug"
  | "audit"
  | "build"
  | "deploy"
  | "deployments"
  | "releases"
  | "serve"
  | "update"
  | "repair"
  | "uninstall";

const commands = new Set<AgentCommand>([
  "status",
  "routes",
  "addons",
  "pairing",
  "preflight",
  "debug",
  "audit",
  "build",
  "deploy",
  "deployments",
  "releases",
  "serve",
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

const parsePort = (value: string | undefined, name: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a valid TCP port.`);
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

export const runCli = async (argv: string[]): Promise<number> => {
  const command = argv[2] ?? "status";

  if (!isAgentCommand(command)) {
    console.error(`Unknown command: ${command}`);
    console.error(
      "Available commands: status, routes, addons, pairing, preflight, debug, audit, build, deploy, deployments, releases, serve, update, repair, uninstall",
    );
    return 1;
  }

  switch (command) {
    case "status":
      printJson(await getAgentStatus());
      return 0;
    case "routes":
      printJson(getRouteSnapshot());
      return 0;
    case "addons":
      printJson(listAvailableAddons());
      return 0;
    case "pairing":
      printJson(getPairingState());
      return 0;
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
    case "deploy":
      try {
        const result = await runLocalDeploy(parseDeployOptions(argv.slice(3)));
        printJson(result);
        return result.deployment.status === "running" ? 0 : 1;
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Deploy failed.");
        return 1;
      }
    case "deployments":
      printJson(await getDeploymentSnapshot());
      return 0;
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
