import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DeploymentRelease, LocalBuildRequest, LocalBuildResult } from "@zoneploy/types";
import { runCommand, type RuntimeCommandResult } from "./commands.js";
import {
  createLocalImageReference,
  createReleaseId,
  saveRelease,
  updateReleaseStatus,
} from "./releases.js";

const commandMaxBuffer = 50 * 1024 * 1024;
const commandTimeoutMs = 30 * 60 * 1000;

const tail = (value: string, maxLength = 16_000): string => {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
};

const commandSummary = (command: string, result: RuntimeCommandResult, startedAt: number) => ({
  command,
  exitCode: result.exitCode,
  durationMs: Date.now() - startedAt,
  stdoutTail: tail(result.stdout),
  stderrTail: tail(result.stderr),
});

const assertDirectory = async (path: string): Promise<void> => {
  const info = await stat(path);

  if (!info.isDirectory()) {
    throw new Error(`${path} is not a directory.`);
  }
};

const assertFile = async (path: string): Promise<void> => {
  const info = await stat(path);

  if (!info.isFile()) {
    throw new Error(`${path} is not a file.`);
  }
};

const createInitialRelease = (input: {
  appId: string;
  contextDir: string;
  dockerfile: string;
  releaseId: string;
}): DeploymentRelease => {
  const now = new Date().toISOString();
  const image = createLocalImageReference({
    appId: input.appId,
    releaseId: input.releaseId,
  });

  return {
    id: input.releaseId,
    appId: input.appId,
    ...image,
    status: "building",
    source: {
      contextDir: input.contextDir,
      dockerfile: input.dockerfile,
    },
    createdAt: now,
    updatedAt: now,
  };
};

export const buildAndPushLocalImage = async (
  request: LocalBuildRequest,
): Promise<LocalBuildResult> => {
  if (request.appId.trim().length === 0) {
    throw new Error("appId is required.");
  }

  const contextDir = resolve(request.contextDir);
  const dockerfile = resolve(contextDir, request.dockerfile ?? "Dockerfile");
  const releaseId = request.releaseId ?? createReleaseId();

  await assertDirectory(contextDir);
  await assertFile(dockerfile);

  const release = await saveRelease(
    createInitialRelease({
      appId: request.appId,
      contextDir,
      dockerfile,
      releaseId,
    }),
  );

  const buildArgs = ["build", "-f", dockerfile, "-t", release.image, contextDir];
  const buildStartedAt = Date.now();
  const build = await runCommand("docker", buildArgs, {
    timeoutMs: commandTimeoutMs,
    maxBuffer: commandMaxBuffer,
  });
  const buildLog = commandSummary(`docker ${buildArgs.join(" ")}`, build, buildStartedAt);

  if (build.exitCode !== 0) {
    return {
      release: await updateReleaseStatus(release, "failed", {
        build: buildLog,
        error: build.stderr || build.stdout || "Docker build failed.",
      }),
    };
  }

  const pushArgs = ["push", release.image];
  const pushStartedAt = Date.now();
  const push = await runCommand("docker", pushArgs, {
    timeoutMs: commandTimeoutMs,
    maxBuffer: commandMaxBuffer,
  });
  const pushLog = commandSummary(`docker ${pushArgs.join(" ")}`, push, pushStartedAt);

  if (push.exitCode !== 0) {
    return {
      release: await updateReleaseStatus(release, "failed", {
        build: buildLog,
        push: pushLog,
        error: push.stderr || push.stdout || "Docker push failed.",
      }),
    };
  }

  return {
    release: await updateReleaseStatus(release, "ready", {
      build: buildLog,
      push: pushLog,
    }),
  };
};
