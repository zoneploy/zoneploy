import http from "node:http";
import { loadAgentRuntimeConfig } from "@zoneploy/runtime";
import { listAvailableAddons } from "./addons.js";
import { getAuditReport } from "./audit.js";
import { getDebugReport } from "./debug.js";
import { getPairingState } from "./pairing.js";
import { getPreflightReport } from "./preflight.js";
import { getReleaseSnapshot } from "./releases.js";
import { getRouteSnapshot } from "./routes.js";
import { getAgentStatus } from "./status.js";

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

const routeHandlers = new Map<string, JsonHandler>([
  ["/health", () => ({ status: "ok", timestamp: new Date().toISOString() })],
  ["/status", getAgentStatus],
  ["/preflight", getPreflightReport],
  ["/debug", getDebugReport],
  ["/audit", getAuditReport],
  ["/addons", listAvailableAddons],
  ["/routes", getRouteSnapshot],
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
  const config = loadAgentRuntimeConfig();

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
      server.close(() => resolve(0));
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
};
