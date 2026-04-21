import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { DeploymentRelease, ReleaseSnapshot, ReleaseStatus } from "@zoneploy/types";
import { loadAgentRuntimeConfig } from "./config.js";

const releaseFileName = "release.json";

const releaseIdPattern = /^[a-zA-Z0-9_.-]{1,128}$/;

export const createReleaseId = (date = new Date()): string => {
  const timestamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z")
    .toLowerCase();

  return `${timestamp}-${randomBytes(4).toString("hex")}`;
};

export const normalizeImageName = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .replace(/[._-]{2,}/g, "-");

  return normalized.length > 0 ? normalized.slice(0, 128) : "app";
};

export const assertValidReleaseId = (releaseId: string): void => {
  if (!releaseIdPattern.test(releaseId)) {
    throw new Error("Release id must be 1-128 Docker tag-safe characters.");
  }
};

export const createLocalImageReference = (input: {
  appId: string;
  releaseId: string;
  registryUrl?: string;
}): {
  image: string;
  imageRepository: string;
  imageTag: string;
  registryUrl: string;
} => {
  assertValidReleaseId(input.releaseId);

  const config = loadAgentRuntimeConfig();
  const registryUrl = input.registryUrl ?? `http://${config.registryHost}:${config.registryPort}`;
  const registryHost = registryUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const imageTag = input.releaseId;
  const imageRepository = `${registryHost}/zoneploy/${normalizeImageName(input.appId)}`;

  return {
    image: `${imageRepository}:${imageTag}`,
    imageRepository,
    imageTag,
    registryUrl,
  };
};

const releasesRoot = (): string => loadAgentRuntimeConfig().releasesDir;

const releasePath = (appId: string, releaseId: string): string => {
  assertValidReleaseId(releaseId);
  return join(releasesRoot(), normalizeImageName(appId), releaseId, releaseFileName);
};

export const releaseDirectoryPath = (appId: string, releaseId: string): string => {
  assertValidReleaseId(releaseId);
  return join(releasesRoot(), normalizeImageName(appId), releaseId);
};

const latestPath = (appId: string): string => {
  return join(releasesRoot(), normalizeImageName(appId), "latest.json");
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmpPath, path);
};

export const saveRelease = async (release: DeploymentRelease): Promise<DeploymentRelease> => {
  await writeJsonFile(releasePath(release.appId, release.id), release);

  if (release.status === "ready") {
    await writeJsonFile(latestPath(release.appId), release);
  }

  return release;
};

export const updateReleaseStatus = async (
  release: DeploymentRelease,
  status: ReleaseStatus,
  extra: Partial<DeploymentRelease> = {},
): Promise<DeploymentRelease> => {
  return saveRelease({
    ...release,
    ...extra,
    status,
    updatedAt: new Date().toISOString(),
  });
};

export const readRelease = async (
  appId: string,
  releaseId: string,
): Promise<DeploymentRelease | null> => {
  try {
    const raw = await readFile(releasePath(appId, releaseId), "utf8");
    return JSON.parse(raw) as DeploymentRelease;
  } catch {
    return null;
  }
};

export const deleteReleaseMetadata = async (
  appId: string,
  releaseId: string,
): Promise<void> => {
  await rm(releaseDirectoryPath(appId, releaseId), { recursive: true, force: true });
};

const readReleaseFile = async (path: string): Promise<DeploymentRelease | null> => {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as DeploymentRelease;
  } catch {
    return null;
  }
};

export const listReleases = async (appId?: string): Promise<DeploymentRelease[]> => {
  const root = releasesRoot();

  try {
    await stat(root);
  } catch {
    return [];
  }

  const appDirs = appId ? [normalizeImageName(appId)] : await readdir(root);
  const releases = await Promise.all(
    appDirs.map(async (appDir) => {
      const appPath = join(root, appDir);
      const entries = await readdir(appPath).catch(() => []);
      const releaseFiles = entries
        .filter((entry) => entry !== "latest.json")
        .map((entry) => join(appPath, entry, releaseFileName));

      return Promise.all(releaseFiles.map(readReleaseFile));
    }),
  );

  return releases
    .flat()
    .filter((release): release is DeploymentRelease => release !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const createReleaseSnapshot = async (appId?: string): Promise<ReleaseSnapshot> => ({
  generatedAt: new Date().toISOString(),
  releases: await listReleases(appId),
});
