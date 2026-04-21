import http from "node:http";
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
