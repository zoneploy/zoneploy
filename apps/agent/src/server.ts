import http from "node:http";
import crypto from "node:crypto";
import { loadAgentRuntimeConfig } from "@zoneploy/runtime";
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
import { getPreflightReport } from "./preflight.js";
import { getReleaseSnapshot } from "./releases.js";
import { runLocalRollback } from "./rollback.js";
import { getRouteSnapshot } from "./routes.js";
import { runLocalRoute } from "./routes.js";
import { getAgentStatus } from "./status.js";
import { handleTerminalUpgrade } from "./terminal.js";
import { handleMetricsStream, isMetricsStreamPath } from "./metrics.js";

type JsonHandler = (request: http.IncomingMessage) => Promise<unknown> | unknown;
type JsonRoute = {
  method: "GET" | "POST";
  public?: boolean;
  handler: JsonHandler;
};

const json = (response: http.ServerResponse, statusCode: number, payload: unknown): void => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
};

const notFound = (response: http.ServerResponse): void => {
  json(response, 404, {
    error: {
      code: "NOT_FOUND",
      message: "Route not found.",
    },
  });
};

const methodNotAllowed = (response: http.ServerResponse): void => {
  json(response, 405, {
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "HTTP method is not allowed for this route.",
    },
  });
};

const unauthorized = (response: http.ServerResponse): void => {
  json(response, 401, {
    error: {
      code: "UNAUTHORIZED",
      message: "A valid agent API token is required.",
    },
  });
};

const authNotConfigured = (response: http.ServerResponse): void => {
  json(response, 503, {
    error: {
      code: "AGENT_API_AUTH_NOT_CONFIGURED",
      message: "ZONEPLOY_AGENT_API_TOKEN is required for the agent HTTP API.",
    },
  });
};

const bearerToken = (request: http.IncomingMessage): string | null => {
  const authorization = request.headers.authorization;

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  return scheme?.toLowerCase() === "bearer" && token ? token : null;
};

const agentToken = (request: http.IncomingMessage): string | null => {
  const header = request.headers["x-zoneploy-agent-token"];

  if (typeof header === "string" && header.trim().length > 0) {
    return header;
  }

  return bearerToken(request);
};

const safeEquals = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBytes, rightBytes);
};

const readJsonBody = async <T>(request: http.IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (!raw) {
    return {} as T;
  }

  return JSON.parse(raw) as T;
};

const routeHandlers = new Map<string, JsonRoute>([
  [
    "/health",
    {
      method: "GET",
      public: true,
      handler: () => ({ status: "ok", timestamp: new Date().toISOString() }),
    },
  ],
  ["/status", { method: "GET", handler: getAgentStatus }],
  ["/preflight", { method: "GET", handler: getPreflightReport }],
  ["/debug", { method: "GET", handler: getDebugReport }],
  ["/audit", { method: "GET", handler: getAuditReport }],
  ["/cleanup", { method: "GET", handler: () => runLocalCleanup(true) }],
  ["/addons", { method: "GET", handler: listAvailableAddons }],
  ["/routes", { method: "GET", handler: getRouteSnapshot }],
  ["/deployments", { method: "GET", handler: getDeploymentSnapshot }],
  [
    "/releases",
    {
      method: "GET",
      handler: (request) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        return getReleaseSnapshot(url.searchParams.get("appId") ?? undefined);
      },
    },
  ],
  [
    "/actions/build",
    {
      method: "POST",
      handler: async (request) => runLocalBuild(await readJsonBody(request)),
    },
  ],
  [
    "/actions/deploy",
    {
      method: "POST",
      handler: async (request) => runLocalDeploy(await readJsonBody(request)),
    },
  ],
  [
    "/actions/route",
    {
      method: "POST",
      handler: async (request) => runLocalRoute(await readJsonBody(request)),
    },
  ],
  [
    "/actions/rollback",
    {
      method: "POST",
      handler: async (request) => runLocalRollback(await readJsonBody(request)),
    },
  ],
  [
    "/actions/cleanup",
    {
      method: "POST",
      handler: async (request) => {
        const body = await readJsonBody<{ apply?: boolean }>(request);
        return runLocalCleanup(body.apply !== true);
      },
    },
  ],
  [
    "/actions/logs",
    {
      method: "POST",
      handler: async (request) => getLocalDeploymentLogs(await readJsonBody(request)),
    },
  ],
  [
    "/actions/remove",
    {
      method: "POST",
      handler: async (request) => runLocalDeploymentRemove(await readJsonBody(request)),
    },
  ],
  [
    "/actions/start",
    {
      method: "POST",
      handler: async (request) => runLocalDeploymentAction("start", await readJsonBody(request)),
    },
  ],
  [
    "/actions/stop",
    {
      method: "POST",
      handler: async (request) => runLocalDeploymentAction("stop", await readJsonBody(request)),
    },
  ],
  [
    "/actions/restart",
    {
      method: "POST",
      handler: async (request) => runLocalDeploymentAction("restart", await readJsonBody(request)),
    },
  ],
]);

export const startAgentServer = async (): Promise<number> => {
  const config = loadAgentRuntimeConfig();

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

      if (isMetricsStreamPath(url.pathname)) {
        if (!config.agentApiToken) {
          authNotConfigured(response);
          return;
        }

        const token = agentToken(request);

        if (!token || !safeEquals(token, config.agentApiToken)) {
          unauthorized(response);
          return;
        }

        try {
          await handleMetricsStream(request, response, url);
        } catch (error) {
          if (!response.headersSent) {
            json(response, 500, {
              error: {
                code: "INTERNAL_ERROR",
                message: error instanceof Error ? error.message : "Unexpected error.",
              },
            });
          } else if (!response.writableEnded) {
            response.write(`event: error\ndata: ${JSON.stringify({
              message: error instanceof Error ? error.message : "Unexpected error.",
            })}\n\n`);
            response.end();
          }
        }

        return;
      }

      const route = routeHandlers.get(url.pathname);

      if (!route) {
        notFound(response);
        return;
      }

      if (request.method !== route.method) {
        methodNotAllowed(response);
        return;
      }

      if (route.public !== true) {
        if (!config.agentApiToken) {
          authNotConfigured(response);
          return;
        }

        const token = agentToken(request);

        if (!token || !safeEquals(token, config.agentApiToken)) {
          unauthorized(response);
          return;
        }
      }

      try {
        json(response, 200, await route.handler(request));
      } catch (error) {
        json(response, 500, {
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "Unexpected error.",
          },
        });
      }
    })();
  });
  server.on("upgrade", (request, socket, head) => {
    if (handleTerminalUpgrade(config, request, socket, head)) {
      return;
    }

    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.agentPort, "0.0.0.0", () => {
      console.log(`Zoneploy agent listening on 0.0.0.0:${config.agentPort}`);
    });

    const shutdown = (): void => {
      server.close(() => resolve(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
};
