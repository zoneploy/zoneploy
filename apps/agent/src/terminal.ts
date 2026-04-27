import { createHmac, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { Duplex } from "node:stream";
import { spawn as spawnPty, type IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { findDeploymentByReference, findStackServiceContainer } from "@zoneploy/runtime";

type AgentTerminalConfig = {
  agentApiToken?: string;
};

type TerminalTarget =
  | { kind: "container"; reference: string }
  | { kind: "stack-service"; projectName: string; serviceName: string }
  | { kind: "server"; cols?: string; rows?: string };

const wss = new WebSocketServer({ noServer: true });
const tokenTtlMs = 5 * 60 * 1000;
const defaultCols = 80;
const defaultRows = 24;

const httpUpgradeError = (socket: Duplex, statusCode: number, message: string): void => {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

const safeEquals = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const verifySignedToken = (
  rawToken: string | null,
  secret: string | undefined,
  expectedSubject?: string,
): boolean => {
  if (!rawToken || !secret) {
    return false;
  }

  const parts = rawToken.split(":");
  if (parts.length < 3) {
    return false;
  }

  const signature = parts.pop() ?? "";
  const timestampText = parts.pop() ?? "";
  const subject = parts.join(":");
  const timestamp = Number(timestampText);

  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > tokenTtlMs) {
    return false;
  }

  if (expectedSubject !== undefined && subject !== expectedSubject) {
    return false;
  }

  const payload = `${subject}:${timestampText}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  return safeEquals(signature, expected);
};

const parseTarget = (url: URL): { target: TerminalTarget; expectedSubject?: string } | null => {
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (
    parts.length === 5 &&
    parts[0] === "agent" &&
    parts[1] === "v1" &&
    parts[2] === "containers" &&
    parts[4] === "terminal"
  ) {
    return {
      target: { kind: "container", reference: parts[3]! },
      expectedSubject: parts[3]!,
    };
  }

  if (
    parts.length === 8 &&
    parts[0] === "agent" &&
    parts[1] === "v1" &&
    parts[2] === "stacks" &&
    parts[5] === "services" &&
    parts[7] === "terminal"
  ) {
    return {
      target: {
        kind: "stack-service",
        projectName: parts[4]!,
        serviceName: parts[6]!,
      },
      expectedSubject: `${parts[4]!}:${parts[6]!}`,
    };
  }

  if (
    parts.length === 4 &&
    parts[0] === "agent" &&
    parts[1] === "v1" &&
    parts[2] === "server" &&
    parts[3] === "terminal"
  ) {
    return {
      target: {
        kind: "server",
        cols: url.searchParams.get("cols") ?? undefined,
        rows: url.searchParams.get("rows") ?? undefined,
      },
    };
  }

  return null;
};

const resolveContainerReference = async (reference: string): Promise<string> => {
  const deployment = await findDeploymentByReference(reference);
  return deployment?.containerName ?? deployment?.containerId ?? reference;
};

const resolveStackServiceReference = async (projectName: string, serviceName: string): Promise<string> => {
  const service = await findStackServiceContainer(projectName, serviceName);
  if (!service?.containerName) {
    throw new Error("Stack service container was not found.");
  }

  return service.containerName;
};

const readDimension = (value: string | number | undefined, fallback: number): number => {
  const number = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(2, Math.min(500, number));
};

const readResizeMessage = (data: RawData): { cols: number; rows: number } | null => {
  if (typeof data !== "string" && !Buffer.isBuffer(data)) {
    return null;
  }

  const text = Buffer.isBuffer(data) ? data.toString("utf8") : data;
  if (!text.startsWith("{")) {
    return null;
  }

  try {
    const message = JSON.parse(text) as { type?: string; cols?: number; rows?: number };
    if (message.type !== "resize") {
      return null;
    }

    return {
      cols: readDimension(message.cols, defaultCols),
      rows: readDimension(message.rows, defaultRows),
    };
  } catch {
    return null;
  }
};

const rawDataToString = (data: RawData): string => {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
};

const attachProcess = (ws: WebSocket, terminal: IPty): void => {
  const output = terminal.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
  const exit = terminal.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  });

  ws.on("message", (data) => {
    const size = readResizeMessage(data);
    if (size) {
      terminal.resize(size.cols, size.rows);
      return;
    }

    terminal.write(rawDataToString(data));
  });

  ws.on("close", () => {
    output.dispose();
    exit.dispose();
    terminal.kill();
  });
};

const spawnHostShell = (target: Extract<TerminalTarget, { kind: "server" }>): IPty => {
  const shell = process.env.SHELL || "/bin/sh";
  const cols = readDimension(target.cols, defaultCols);
  const rows = readDimension(target.rows, defaultRows);

  return spawnPty(shell, ["-i"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLUMNS: String(cols),
      LINES: String(rows),
    },
  });
};

const spawnContainerShell = (containerName: string): IPty => {
  return spawnPty(
    "docker",
    [
      "exec",
      "-it",
      "-e",
      "TERM=xterm-256color",
      containerName,
      "sh",
      "-lc",
      "if command -v bash >/dev/null 2>&1; then exec bash -i; else exec sh -i; fi",
    ],
    {
      name: "xterm-256color",
      cols: defaultCols,
      rows: defaultRows,
      cwd: process.cwd(),
      env: process.env,
    },
  );
};

const openTerminal = async (target: TerminalTarget): Promise<IPty> => {
  if (target.kind === "server") {
    return spawnHostShell(target);
  }

  if (target.kind === "container") {
    return spawnContainerShell(await resolveContainerReference(target.reference));
  }

  return spawnContainerShell(await resolveStackServiceReference(target.projectName, target.serviceName));
};

export const handleTerminalUpgrade = (
  config: AgentTerminalConfig,
  request: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const parsed = parseTarget(url);
  if (!parsed) {
    return false;
  }

  if (!config.agentApiToken) {
    httpUpgradeError(socket, 503, "Service Unavailable");
    return true;
  }

  if (!verifySignedToken(url.searchParams.get("token"), config.agentApiToken, parsed.expectedSubject)) {
    httpUpgradeError(socket, 401, "Unauthorized");
    return true;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    void (async () => {
      try {
        attachProcess(ws, await openTerminal(parsed.target));
      } catch (error) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\r\n${error instanceof Error ? error.message : "Terminal failed."}\r\n`);
          ws.close(1011, "Terminal failed");
        }
      }
    })();
  });

  return true;
};
