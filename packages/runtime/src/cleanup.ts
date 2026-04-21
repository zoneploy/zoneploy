import type { CleanupDeletedRelease, CleanupResult, DeploymentRelease } from "@zoneploy/types";
import { runCommand } from "./commands.js";
import { loadAgentRuntimeConfig } from "./config.js";
import { listDeployments } from "./deployments.js";
import { deleteReleaseMetadata, listReleases } from "./releases.js";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

const byApp = (releases: DeploymentRelease[]): Map<string, DeploymentRelease[]> => {
  const grouped = new Map<string, DeploymentRelease[]>();

  for (const release of releases) {
    grouped.set(release.appId, [...(grouped.get(release.appId) ?? []), release]);
  }

  for (const values of grouped.values()) {
    values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return grouped;
};

const deleteDockerImage = async (image: string): Promise<boolean> => {
  const result = await runCommand("docker", ["image", "rm", "-f", image], 60_000);
  return result.exitCode === 0;
};

const parseRegistryImage = (
  image: string,
): { registry: string; repository: string; tag: string } | null => {
  const slashIndex = image.indexOf("/");
  const tagIndex = image.lastIndexOf(":");

  if (slashIndex < 1 || tagIndex <= slashIndex + 1) {
    return null;
  }

  return {
    registry: image.slice(0, slashIndex),
    repository: image.slice(slashIndex + 1, tagIndex),
    tag: image.slice(tagIndex + 1),
  };
};

const deleteRegistryManifest = async (image: string): Promise<boolean> => {
  const parsed = parseRegistryImage(image);

  if (!parsed) {
    return false;
  }

  const baseUrl = `http://${parsed.registry}/v2/${parsed.repository}/manifests/${parsed.tag}`;
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");
  const head = await fetch(baseUrl, {
    method: "HEAD",
    headers: {
      Accept: accept,
    },
  }).catch(() => null);

  if (!head?.ok) {
    return false;
  }

  const digest = head.headers.get("docker-content-digest");

  if (!digest) {
    return false;
  }

  const deleted = await fetch(
    `http://${parsed.registry}/v2/${parsed.repository}/manifests/${digest}`,
    {
      method: "DELETE",
    },
  ).catch(() => null);

  return deleted?.ok ?? false;
};

const pruneDockerImages = async (): Promise<boolean> => {
  const result = await runCommand("docker", ["image", "prune", "-f"], 60_000);
  return result.exitCode === 0;
};

const runRegistryGarbageCollect = async (): Promise<boolean> => {
  const config = loadAgentRuntimeConfig();
  const stop = await runCommand("docker", ["stop", "zoneploy-registry"], 60_000);

  if (stop.exitCode === 0) {
    const result = await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${config.registryDir}:/var/lib/registry`,
        "-v",
        `${config.registryConfigFile}:/etc/docker/registry/config.yml:ro`,
        "registry:2",
        "garbage-collect",
        "/etc/docker/registry/config.yml",
      ],
      5 * 60_000,
    );

    await runCommand("docker", ["start", "zoneploy-registry"], 60_000);

    return result.exitCode === 0;
  }

  const fallback = await runCommand(
    "docker",
    [
      "exec",
      "zoneploy-registry",
      "registry",
      "garbage-collect",
      "/etc/docker/registry/config.yml",
    ],
    5 * 60_000,
  );

  return fallback.exitCode === 0;
};

export const cleanupLocalRuntime = async (dryRun = false): Promise<CleanupResult> => {
  const config = loadAgentRuntimeConfig();
  const releases = await listReleases();
  const deployments = await listDeployments();
  const activeReleaseIds = new Set(deployments.map((deployment) => deployment.releaseId));
  const grouped = byApp(releases);
  const now = Date.now();
  const deletedReleases: CleanupDeletedRelease[] = [];
  const deletedImages: string[] = [];
  const deletedRegistryManifests: string[] = [];

  if (!config.cleanupPolicy.enabled) {
    return {
      generatedAt: new Date().toISOString(),
      enabled: false,
      dryRun,
      policy: {
        keepReleases: config.cleanupPolicy.keepReleases,
        keepDays: config.cleanupPolicy.keepDays,
        maxRegistryGb: config.cleanupPolicy.maxRegistryGb,
      },
      keptActiveReleaseIds: [...activeReleaseIds].sort(),
      deletedReleases,
      deletedImages,
      deletedRegistryManifests,
      prunedDockerObjects: false,
      registryGarbageCollectAttempted: false,
      registryGarbageCollectSucceeded: false,
    };
  }

  for (const appReleases of grouped.values()) {
    appReleases.forEach((release, index) => {
      if (activeReleaseIds.has(release.id)) {
        return;
      }

      const ageDays = (now - Date.parse(release.createdAt)) / millisecondsPerDay;
      const overCount = index >= config.cleanupPolicy.keepReleases;
      const overAge = config.cleanupPolicy.keepDays > 0 && ageDays > config.cleanupPolicy.keepDays;

      if (overCount || overAge) {
        deletedReleases.push({
          appId: release.appId,
          releaseId: release.id,
          image: release.image,
          reason: overCount ? "count" : "age",
        });
      }
    });
  }

  if (!dryRun) {
    for (const release of deletedReleases) {
      if (await deleteRegistryManifest(release.image)) {
        deletedRegistryManifests.push(release.image);
      }

      await deleteReleaseMetadata(release.appId, release.releaseId);

      if (await deleteDockerImage(release.image)) {
        deletedImages.push(release.image);
      }
    }
  } else {
    deletedImages.push(...deletedReleases.map((release) => release.image));
  }

  const prunedDockerObjects = dryRun ? false : await pruneDockerImages();
  const registryGarbageCollectAttempted = !dryRun && deletedReleases.length > 0;
  const registryGarbageCollectSucceeded = registryGarbageCollectAttempted
    ? await runRegistryGarbageCollect()
    : false;

  return {
    generatedAt: new Date().toISOString(),
    enabled: true,
    dryRun,
    policy: {
      keepReleases: config.cleanupPolicy.keepReleases,
      keepDays: config.cleanupPolicy.keepDays,
      maxRegistryGb: config.cleanupPolicy.maxRegistryGb,
    },
    keptActiveReleaseIds: [...activeReleaseIds].sort(),
    deletedReleases,
    deletedImages,
    deletedRegistryManifests,
    prunedDockerObjects,
    registryGarbageCollectAttempted,
    registryGarbageCollectSucceeded,
  };
};
