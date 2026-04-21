import { listAvailableAddons } from "./addons.js";
import { getPairingState } from "./pairing.js";
import { getRouteSnapshot } from "./routes.js";
import { getAgentStatus } from "./status.js";

type AgentCommand = "status" | "routes" | "addons" | "pairing";

const commands = new Set<AgentCommand>(["status", "routes", "addons", "pairing"]);

const isAgentCommand = (value: string): value is AgentCommand => {
  return commands.has(value as AgentCommand);
};

const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value, null, 2));
};

export const runCli = (argv: string[]): number => {
  const command = argv[2] ?? "status";

  if (!isAgentCommand(command)) {
    console.error(`Unknown command: ${command}`);
    console.error("Available commands: status, routes, addons, pairing");
    return 1;
  }

  switch (command) {
    case "status":
      printJson(getAgentStatus());
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
  }
};
