import type { PortListener, PortStatus } from "@zoneploy/types";
import { commandExists, runCommand } from "./commands.js";

const parseListener = (line: string): PortListener[] => {
  const listeners: PortListener[] = [];
  const processMatches = line.matchAll(/users:\(\("([^"]+)",pid=(\d+)/g);

  for (const match of processMatches) {
    listeners.push({
      processName: match[1] ?? null,
      pid: match[2] ? Number(match[2]) : null,
    });
  }

  return listeners;
};

const parsePortFromAddress = (address: string): number | null => {
  const match = address.match(/:(\d+)$/);

  if (!match?.[1]) {
    return null;
  }

  const port = Number(match[1]);
  return Number.isInteger(port) ? port : null;
};

const readLinuxTcpListeners = async (): Promise<Map<number, PortListener[]>> => {
  if (process.platform !== "linux" || !(await commandExists("ss"))) {
    return new Map();
  }

  const result = await runCommand("ss", ["-H", "-ltnp"], 5_000);

  if (result.exitCode !== 0) {
    return new Map();
  }

  const listeners = new Map<number, PortListener[]>();

  for (const line of result.stdout.split("\n")) {
    const columns = line.trim().split(/\s+/);
    const localAddress = columns[3];

    if (!localAddress) {
      continue;
    }

    const port = parsePortFromAddress(localAddress);

    if (port === null) {
      continue;
    }

    listeners.set(port, parseListener(line));
  }

  return listeners;
};

export const collectPortStatuses = async (ports: number[]): Promise<PortStatus[]> => {
  const listeners = await readLinuxTcpListeners();

  return ports.map((port) => {
    const portListeners = listeners.get(port) ?? [];

    return {
      port,
      protocol: "tcp",
      available: portListeners.length === 0,
      listeners: portListeners,
    };
  });
};
