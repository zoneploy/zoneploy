export type ReleaseStatus = "building" | "ready" | "failed";

export type ReleaseSource = {
  contextDir: string;
  dockerfile: string;
};

export type ReleaseBuildLog = {
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

export type DeploymentRelease = {
  id: string;
  appId: string;
  image: string;
  imageRepository: string;
  imageTag: string;
  registryUrl: string;
  status: ReleaseStatus;
  source: ReleaseSource;
  createdAt: string;
  updatedAt: string;
  build?: ReleaseBuildLog;
  push?: ReleaseBuildLog;
  error?: string;
};

export type LocalBuildRequest = {
  appId: string;
  contextDir: string;
  dockerfile?: string;
  releaseId?: string;
};

export type LocalBuildResult = {
  release: DeploymentRelease;
};

export type ReleaseSnapshot = {
  generatedAt: string;
  releases: DeploymentRelease[];
};

export type CleanupDeletedRelease = {
  appId: string;
  releaseId: string;
  image: string;
  reason: "count" | "age";
};

export type CleanupResult = {
  generatedAt: string;
  enabled: boolean;
  dryRun: boolean;
  policy: {
    keepReleases: number;
    keepDays: number;
    maxRegistryGb: number;
  };
  keptActiveReleaseIds: string[];
  deletedReleases: CleanupDeletedRelease[];
  deletedImages: string[];
  deletedRegistryManifests: string[];
  prunedDockerObjects: boolean;
  registryGarbageCollectAttempted: boolean;
  registryGarbageCollectSucceeded: boolean;
};

export type RollbackRequest = {
  deploymentName: string;
  releaseId: string;
};
