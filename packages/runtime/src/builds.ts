import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { DeploymentRelease, LocalBuildRequest, LocalBuildResult, LocalGitSource } from "@zoneploy/types";
import { runCommand, type RuntimeCommandResult } from "./commands.js";
import {
  createLocalImageReference,
  createReleaseId,
  saveRelease,
  updateReleaseStatus,
} from "./releases.js";
import { loadAgentRuntimeConfig } from "./config.js";

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

const assertRelativePath = (path: string, label: string): string => {
  const value = path.trim() || ".";

  if (value.startsWith("/") || value.includes("..")) {
    throw new Error(`${label} must be a relative path inside the repository.`);
  }

  return value;
};

const createAskpassScript = async (token: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "zoneploy-git-askpass-"));
  const scriptPath = join(dir, "askpass.sh");
  const escapedToken = token.replaceAll("'", "'\"'\"'");

  await writeFile(
    scriptPath,
    `#!/usr/bin/env sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *) printf '%s\\n' '${escapedToken}' ;;
esac
`,
    "utf8",
  );
  await chmod(scriptPath, 0o700);

  return scriptPath;
};

const normalizeRef = (ref?: string): string | undefined => {
  const value = ref?.trim();
  if (!value) return undefined;
  return value.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
};

export const checkoutGitSource = async (
  source: LocalGitSource,
  releaseId: string,
): Promise<{ checkoutDir: string; contextDir: string; dockerfile: string }> => {
  const repository = source.repository.trim();
  if (!repository) {
    throw new Error("git.repository is required.");
  }

  const config = loadAgentRuntimeConfig();
  const checkoutRoot = join(config.buildsDir, "git", releaseId);
  const checkoutDir = join(checkoutRoot, "source");
  const contextPath = assertRelativePath(source.contextPath ?? ".", "git.contextPath");
  const dockerfile = assertRelativePath(source.dockerfile ?? "Dockerfile", "git.dockerfile");
  const ref = normalizeRef(source.ref);
  let askpassScript: string | null = null;

  await rm(checkoutRoot, { recursive: true, force: true });
  await mkdir(checkoutRoot, { recursive: true });

  const cloneArgs = ["clone", "--depth", "1"];
  if (ref) {
    cloneArgs.push("--branch", ref);
  }
  cloneArgs.push(repository, checkoutDir);

  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
  };

  if (source.token?.trim()) {
    askpassScript = await createAskpassScript(source.token.trim());
    env.GIT_ASKPASS = askpassScript;
  }

  try {
    const clone = await runCommand("git", cloneArgs, {
      timeoutMs: 5 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
      env,
    });

    if (clone.exitCode !== 0) {
      throw new Error(clone.stderr || clone.stdout || "Git clone failed.");
    }

    if (source.commitSha?.trim()) {
      const checkout = await runCommand("git", ["checkout", "--detach", source.commitSha.trim()], {
        cwd: checkoutDir,
        timeoutMs: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env,
      });

      if (checkout.exitCode !== 0) {
        throw new Error(checkout.stderr || checkout.stdout || "Git checkout failed.");
      }
    }
  } finally {
    if (askpassScript) {
      await rm(resolve(askpassScript, ".."), { recursive: true, force: true });
    }
  }

  return {
    checkoutDir,
    contextDir: resolve(checkoutDir, contextPath),
    dockerfile,
  };
};

export const buildAndPushGitImage = async (
  request: Omit<LocalBuildRequest, "contextDir"> & { git: LocalGitSource },
): Promise<LocalBuildResult> => {
  const releaseId = request.releaseId ?? createReleaseId();
  const checkout = await checkoutGitSource(request.git, releaseId);

  return buildAndPushLocalImage({
    appId: request.appId,
    contextDir: checkout.contextDir,
    dockerfile: checkout.dockerfile,
    releaseId,
  });
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
