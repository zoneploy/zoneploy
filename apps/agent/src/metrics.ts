import os from "node:os";
import type http from "node:http";
import {
  findDeploymentByReference,
  findStackServiceContainer,
  runCommand,
} from "@zoneploy/runtime";

type CpuSnapshot = {
  idle: number;
  total: number;
};

type DockerStatsRow = {
  Container?: string;
  ID?: string;
  Name?: string;
  CPUPerc?: string;
  MemUsage?: string;
  NetIO?: string;
  BlockIO?: string;
};

type ContainerMetric = {
  dockerId: string;
  name: string;
  status: string;
  cpuPercent: number;
  memoryUsedMb: number;
  diskReadMb: number;
  diskWriteMb: number;
  netRxMb: number;
  netTxMb: number;
};

type MetricsTarget =
  | { kind: "server" }
  | { kind: "container"; reference: string }
  | { kind: "stack-service"; projectName: string; serviceName: string };

type ResolvedMetricsTarget =
  | { kind: "server" }
  | { kind: "container"; references: string[] };

const streamIntervalMs = 2_000;
const initialCpuSampleMs = 250;
const mb = 1024 * 1024;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const cpuSnapshot = (): CpuSnapshot => {
  return os.cpus().reduce<CpuSnapshot>(
    (acc, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return {
        idle: acc.idle + cpu.times.idle,
        total: acc.total + total,
      };
    },
    { idle: 0, total: 0 },
  );
};

const cpuPercent = (previous: CpuSnapshot, current: CpuSnapshot): number => {
  const idle = current.idle - previous.idle;
  const total = current.total - previous.total;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
};

const parseMetricsTarget = (pathname: string): MetricsTarget | null => {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (
    parts.length === 4 &&
    parts[0] === "agent" &&
    parts[1] === "v1" &&
    parts[2] === "metrics" &&
    parts[3] === "stream"
  ) {
    return { kind: "server" };
  }

  if (
    parts.length === 6 &&
    parts[0] === "agent" &&
    parts[1] === "v1" &&
    parts[2] === "containers" &&
    parts[4] === "metrics" &&
    parts[5] === "stream"
  ) {
    return { kind: "container", reference: parts[3]! };
  }

  if (
    parts.length === 9 &&
    parts[0] === "agent" &&
    parts[1] === "v1" &&
    parts[2] === "stacks" &&
    parts[5] === "services" &&
    parts[7] === "metrics" &&
    parts[8] === "stream"
  ) {
    return {
      kind: "stack-service",
      projectName: parts[4]!,
      serviceName: parts[6]!,
    };
  }

  return null;
};

export const isMetricsStreamPath = (pathname: string): boolean => parseMetricsTarget(pathname) !== null;

const numeric = (value: number): number => Number.isFinite(value) ? value : 0;

const parsePercent = (value: string | undefined): number => {
  const parsed = Number.parseFloat((value ?? "").replace("%", "").replace(",", "."));
  return numeric(parsed);
};

const parseDockerSizeMb = (value: string | undefined): number => {
  const match = (value ?? "").trim().replace(",", ".").match(/^([\d.]+)\s*([kmgt]?i?b|b)$/i);
  if (!match) return 0;

  const amount = Number.parseFloat(match[1]!);
  if (!Number.isFinite(amount)) return 0;

  const unit = match[2]!.toLowerCase();
  const factor: Record<string, number> = {
    b: 1 / mb,
    kb: 1 / 1024,
    kib: 1 / 1024,
    mb: 1,
    mib: 1,
    gb: 1024,
    gib: 1024,
    tb: 1024 * 1024,
    tib: 1024 * 1024,
  };

  return amount * (factor[unit] ?? 0);
};

const parseDockerPairMb = (value: string | undefined): [number, number] => {
  const [left, right] = (value ?? "").split("/").map((part) => part.trim());
  return [parseDockerSizeMb(left), parseDockerSizeMb(right)];
};

const collectStorage = async (): Promise<{ usedMb: number; totalMb: number }> => {
  if (process.platform !== "linux") {
    return { usedMb: 0, totalMb: 0 };
  }

  const result = await runCommand("df", ["-Pm", "/"], 5_000);
  if (result.exitCode !== 0) {
    return { usedMb: 0, totalMb: 0 };
  }

  const [, line] = result.stdout.trim().split("\n");
  const columns = line?.split(/\s+/) ?? [];
  const totalMb = Number(columns[1]);
  const usedMb = Number(columns[2]);

  return {
    usedMb: numeric(usedMb),
    totalMb: numeric(totalMb),
  };
};

const collectDockerStats = async (): Promise<ContainerMetric[]> => {
  const result = await runCommand(
    "docker",
    ["stats", "--no-stream", "--format", "{{json .}}"],
    { timeoutMs: 8_000, maxBuffer: 16 * 1024 * 1024 },
  );

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const row = JSON.parse(line) as DockerStatsRow;
        const [netRxMb, netTxMb] = parseDockerPairMb(row.NetIO);
        const [diskReadMb, diskWriteMb] = parseDockerPairMb(row.BlockIO);
        const [memoryUsedMb] = parseDockerPairMb(row.MemUsage);

        return {
          dockerId: row.ID ?? row.Container ?? "",
          name: (row.Name ?? "").replace(/^\//, ""),
          status: "running",
          cpuPercent: parsePercent(row.CPUPerc),
          memoryUsedMb,
          diskReadMb,
          diskWriteMb,
          netRxMb,
          netTxMb,
        } satisfies ContainerMetric;
      } catch {
        return null;
      }
    })
    .filter((metric): metric is ContainerMetric => metric !== null && Boolean(metric.dockerId || metric.name));
};

const collectServerMetrics = async (previousCpu: CpuSnapshot): Promise<{ payload: unknown; cpu: CpuSnapshot }> => {
  const currentCpu = cpuSnapshot();
  const memoryTotalMb = Math.round(os.totalmem() / mb);
  const memoryUsedMb = Math.max(0, memoryTotalMb - Math.round(os.freemem() / mb));
  const storage = await collectStorage();
  const containers = await collectDockerStats();

  return {
    cpu: currentCpu,
    payload: {
      server: {
        cpuPercent: cpuPercent(previousCpu, currentCpu),
        memoryUsedMb,
        memoryTotalMb,
        storageUsedMb: storage.usedMb,
        storageTotalMb: storage.totalMb,
        cpuCores: os.cpus().length,
      },
      containers,
      ts: new Date().toISOString(),
    },
  };
};

const normalizeReference = (value: string | undefined): string | null => {
  const normalized = (value ?? "").replace(/^\//, "").trim();
  return normalized ? normalized : null;
};

const resolveTarget = async (target: MetricsTarget): Promise<ResolvedMetricsTarget> => {
  if (target.kind === "server") return target;

  if (target.kind === "stack-service") {
    const service = await findStackServiceContainer(target.projectName, target.serviceName);
    return {
      kind: "container",
      references: [
        target.serviceName,
        service?.containerName,
        service?.dockerId,
      ].map(normalizeReference).filter((value): value is string => value !== null),
    };
  }

  const deployment = await findDeploymentByReference(target.reference).catch(() => null);
  return {
    kind: "container",
    references: [
      target.reference,
      deployment?.containerName,
      deployment?.containerId,
      deployment?.name,
    ].map(normalizeReference).filter((value): value is string => value !== null),
  };
};

const matchesReference = (metric: ContainerMetric, references: string[]): boolean => {
  return references.some((reference) => {
    return metric.name === reference
      || metric.dockerId === reference
      || (metric.dockerId.length > 0 && metric.dockerId.startsWith(reference))
      || (metric.dockerId.length > 0 && reference.startsWith(metric.dockerId));
  });
};

const collectContainerMetrics = async (target: Extract<ResolvedMetricsTarget, { kind: "container" }>): Promise<unknown> => {
  const stats = await collectDockerStats();
  const metric = stats.find((entry) => matchesReference(entry, target.references));

  if (!metric) {
    throw new Error("Container metrics are not available.");
  }

  return {
    ...metric,
    ts: new Date().toISOString(),
  };
};

const writeSse = (response: http.ServerResponse, payload: unknown): void => {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const writeSseError = (response: http.ServerResponse, error: unknown): void => {
  response.write(`event: error\ndata: ${JSON.stringify({
    message: error instanceof Error ? error.message : "Metrics collection failed.",
  })}\n\n`);
};

export const handleMetricsStream = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  url: URL,
): Promise<boolean> => {
  const target = parseMetricsTarget(url.pathname);
  if (!target) return false;

  if (request.method !== "GET") {
    response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "HTTP method is not allowed for this route." } }));
    return true;
  }

  const resolvedTarget = await resolveTarget(target);
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  let closed = false;
  let previousCpu = cpuSnapshot();

  request.on("close", () => {
    closed = true;
  });

  await sleep(initialCpuSampleMs);

  while (!closed && !response.writableEnded) {
    try {
      if (resolvedTarget.kind === "server") {
        const result = await collectServerMetrics(previousCpu);
        previousCpu = result.cpu;
        writeSse(response, result.payload);
      } else {
        writeSse(response, await collectContainerMetrics(resolvedTarget));
      }
    } catch (error) {
      writeSseError(response, error);
    }

    await sleep(streamIntervalMs);
  }

  if (!response.writableEnded) {
    response.end();
  }

  return true;
};
