import { hostname } from "node:os";
import type {
  CloudCommandResult,
  CloudPollRequest,
  CloudPollResponse,
  PairingRequest,
  PairingResult,
  PairingState,
} from "@zoneploy/types";
import { loadAgentRuntimeConfig } from "./config.js";
import { updateEnvFile } from "./env-file.js";

type CloudPairResponse = {
  instanceId: string;
  agentToken: string;
  pairedAt?: string;
};

const joinCloudUrl = (cloudUrl: string, path: string): string => {
  return `${cloudUrl.replace(/\/+$/, "")}${path}`;
};

const fetchJson = async <T>(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await response.text();
    let body: unknown = {};
    try {
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(
        response.ok
          ? `Cloud response was not valid JSON${preview ? `: ${preview}` : "."}`
          : `Cloud request failed with HTTP ${response.status}${preview ? `: ${preview}` : "."}`,
      );
    }

    if (!response.ok) {
      const payload = body && typeof body === "object" ? body as { error?: { message?: unknown } } : {};
      const message =
        typeof payload.error?.message === "string"
          ? payload.error.message
          : `Cloud request failed with HTTP ${response.status}.`;
      throw new Error(message);
    }

    return body as T;
  } finally {
    clearTimeout(timeout);
  }
};

export const createPairingState = (): PairingState => {
  const config = loadAgentRuntimeConfig();

  return {
    paired: config.profile === "paired" && Boolean(config.cloudUrl && config.agentToken),
    pairingTokenSet: config.pairingTokenSet,
    agentTokenSet: config.agentTokenSet,
    commandPollIntervalSeconds: config.commandPollIntervalSeconds,
    ...(config.cloudUrl ? { cloudUrl: config.cloudUrl } : {}),
    ...(config.instanceId ? { instanceId: config.instanceId } : {}),
    ...(config.pairedAt ? { pairedAt: config.pairedAt } : {}),
  };
};

export const pairAgentWithCloud = async (
  request: PairingRequest,
  agentVersion: string,
): Promise<PairingResult> => {
  const cloudUrl = request.cloudUrl.trim().replace(/\/+$/, "");

  if (!cloudUrl) {
    throw new Error("cloudUrl is required.");
  }

  if (!request.pairingToken.trim()) {
    throw new Error("pairingToken is required.");
  }

  const pairResponse = await fetchJson<CloudPairResponse>(
    joinCloudUrl(cloudUrl, "/api/v1/agent/pair"),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.pairingToken}`,
      },
      body: JSON.stringify({
        instanceName: request.instanceName?.trim() || hostname(),
        agentVersion,
      }),
    },
  );

  if (!pairResponse.instanceId || !pairResponse.agentToken) {
    throw new Error("Cloud pairing response is missing instanceId or agentToken.");
  }

  const pairedAt = pairResponse.pairedAt ?? new Date().toISOString();
  const config = loadAgentRuntimeConfig();

  await updateEnvFile(config.agentEnvFile, {
    ZONEPLOY_PROFILE: "paired",
    ZONEPLOY_CLOUD_URL: cloudUrl,
    ZONEPLOY_INSTANCE_ID: pairResponse.instanceId,
    ZONEPLOY_AGENT_TOKEN: pairResponse.agentToken,
    ZONEPLOY_PAIRED_AT: pairedAt,
    ZONEPLOY_PAIRING_TOKEN: undefined,
  });

  process.env.ZONEPLOY_PROFILE = "paired";
  process.env.ZONEPLOY_CLOUD_URL = cloudUrl;
  process.env.ZONEPLOY_INSTANCE_ID = pairResponse.instanceId;
  process.env.ZONEPLOY_AGENT_TOKEN = pairResponse.agentToken;
  process.env.ZONEPLOY_PAIRED_AT = pairedAt;
  delete process.env.ZONEPLOY_PAIRING_TOKEN;

  return {
    instanceId: pairResponse.instanceId,
    cloudUrl,
    pairedAt,
    agentTokenSet: true,
    restartRequired: true,
  };
};

export const ensureAgentPairing = async (agentVersion: string): Promise<PairingState> => {
  const config = loadAgentRuntimeConfig();

  if (config.profile !== "paired" || !config.cloudUrl) {
    return createPairingState();
  }

  if (config.agentToken) {
    return createPairingState();
  }

  const pairingToken = process.env.ZONEPLOY_PAIRING_TOKEN;

  if (!pairingToken) {
    return createPairingState();
  }

  await pairAgentWithCloud(
    {
      cloudUrl: config.cloudUrl,
      pairingToken,
    },
    agentVersion,
  );

  return createPairingState();
};

export const unpairAgentFromCloud = async (): Promise<PairingState> => {
  const config = loadAgentRuntimeConfig();

  await updateEnvFile(config.agentEnvFile, {
    ZONEPLOY_PROFILE: "standalone",
    ZONEPLOY_CLOUD_URL: undefined,
    ZONEPLOY_INSTANCE_ID: undefined,
    ZONEPLOY_AGENT_TOKEN: undefined,
    ZONEPLOY_PAIRED_AT: undefined,
    ZONEPLOY_PAIRING_TOKEN: undefined,
  });

  process.env.ZONEPLOY_PROFILE = "standalone";
  delete process.env.ZONEPLOY_CLOUD_URL;
  delete process.env.ZONEPLOY_INSTANCE_ID;
  delete process.env.ZONEPLOY_AGENT_TOKEN;
  delete process.env.ZONEPLOY_PAIRED_AT;
  delete process.env.ZONEPLOY_PAIRING_TOKEN;

  return createPairingState();
};

export const pollCloudCommands = async (
  request: CloudPollRequest,
): Promise<CloudPollResponse> => {
  const config = loadAgentRuntimeConfig();

  if (!config.cloudUrl || !config.agentToken) {
    throw new Error("Agent is not paired with Cloud.");
  }

  return fetchJson<CloudPollResponse>(
    joinCloudUrl(config.cloudUrl, "/api/v1/agent/poll"),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.agentToken}`,
      },
      body: JSON.stringify(request),
    },
    30_000,
  );
};

export const reportCloudCommandResult = async (
  result: CloudCommandResult,
): Promise<void> => {
  const config = loadAgentRuntimeConfig();

  if (!config.cloudUrl || !config.agentToken) {
    throw new Error("Agent is not paired with Cloud.");
  }

  await fetchJson<Record<string, never>>(
    joinCloudUrl(config.cloudUrl, `/api/v1/agent/commands/${encodeURIComponent(result.commandId)}/result`),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.agentToken}`,
      },
      body: JSON.stringify(result),
    },
    30_000,
  );
};
