import { spawnSync } from "node:child_process";

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
