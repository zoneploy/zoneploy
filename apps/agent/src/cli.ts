import { listAvailableAddons } from "./addons.js";
import { getAuditReport } from "./audit.js";
import { getDebugReport } from "./debug.js";
import { runAgentOperation } from "./operations.js";
import { getPairingState } from "./pairing.js";
import { getPreflightReport } from "./preflight.js";
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

export const runCli = async (argv: string[]): Promise<number> => {
  const command = argv[2] ?? "status";

  if (!isAgentCommand(command)) {
    console.error(`Unknown command: ${command}`);
    console.error(
      "Available commands: status, routes, addons, pairing, preflight, debug, audit, serve, update, repair, uninstall",
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
