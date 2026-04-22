import { spawn, spawnSync } from "node:child_process";

export type AgentOperation = "update" | "repair" | "uninstall";

const helperByOperation: Record<AgentOperation, string> = {
  update: "zoneploy-agent-update",
  repair: "zoneploy-agent-repair",
  uninstall: "zoneploy-agent-uninstall",
};

export const runAgentOperation = (operation: AgentOperation, args: string[]): number => {
  const helper = helperByOperation[operation];
  const result = spawnSync(helper, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(
      `Unable to run ${helper}. This command is available after installing Zoneploy on a Linux host.`,
    );
    return 127;
  }

  return result.status ?? 1;
};

const quoteShellArg = (value: string): string => `'${value.replace(/'/g, "'\"'\"'")}'`;

export const scheduleAgentOperation = (
  operation: AgentOperation,
  args: string[] = [],
  delaySeconds = 3,
): { ok: true; message: string } => {
  const helper = helperByOperation[operation];
  const delay = Math.max(1, Math.floor(delaySeconds));

  const child = process.platform === "win32"
    ? spawn(helper, args, { detached: true, stdio: "ignore", shell: true })
    : spawn(
      "sh",
      [
        "-lc",
        `sleep ${delay}; exec ${quoteShellArg(helper)} ${args.map(quoteShellArg).join(" ")}`,
      ],
      { detached: true, stdio: "ignore" },
    );

  child.unref();

  return {
    ok: true,
    message: operation === "uninstall"
      ? "Agent uninstall scheduled. The service will stop shortly."
      : `Agent ${operation} scheduled. The service will restart shortly.`,
  };
};
