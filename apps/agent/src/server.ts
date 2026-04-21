import http from "node:http";
import crypto from "node:crypto";
import { ensureAgentPairing, loadAgentRuntimeConfig } from "@zoneploy/runtime";
import { listAvailableAddons } from "./addons.js";
import { getAuditReport } from "./audit.js";
import { startCloudCommandWorker } from "./cloud-worker.js";
import { runLocalCleanup } from "./cleanup.js";
import { getDeploymentSnapshot } from "./deployments.js";
import { getDebugReport } from "./debug.js";
import { getPairingState } from "./pairing.js";
import { getPreflightReport } from "./preflight.js";
import { getReleaseSnapshot } from "./releases.js";
import { getRouteSnapshot } from "./routes.js";
import { getAgentStatus } from "./status.js";
import { agentVersion } from "./version.js";

type JsonHandler = (request: http.IncomingMessage) => Promise<unknown> | unknown;

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
      message: "Only GET is supported by the diagnostic API.",
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

const routeHandlers = new Map<string, JsonHandler>([
  ["/health", () => ({ status: "ok", timestamp: new Date().toISOString() })],
  ["/status", getAgentStatus],
  ["/preflight", getPreflightReport],
  ["/debug", getDebugReport],
  ["/audit", getAuditReport],
  ["/cleanup", () => runLocalCleanup(true)],
  ["/addons", listAvailableAddons],
  ["/routes", getRouteSnapshot],
  ["/deployments", getDeploymentSnapshot],
  [
    "/releases",
    (request) => {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      return getReleaseSnapshot(url.searchParams.get("appId") ?? undefined);
    },
  ],
  ["/pairing", getPairingState],
]);

export const startAgentServer = async (): Promise<number> => {
  try {
    await ensureAgentPairing(agentVersion);
  } catch (error) {
    console.warn(
      `Zoneploy cloud pairing failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  const config = loadAgentRuntimeConfig();
  const cloudWorker = startCloudCommandWorker();

  const server = http.createServer((request, response) => {
    void (async () => {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const handler = routeHandlers.get(url.pathname);

      if (!handler) {
        notFound(response);
        return;
      }

      if (url.pathname !== "/health") {
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
        json(response, 200, await handler(request));
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

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.agentPort, "0.0.0.0", () => {
      console.log(`Zoneploy agent listening on 0.0.0.0:${config.agentPort}`);
    });

    const shutdown = (): void => {
      cloudWorker.stop();
      server.close(() => resolve(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
};
