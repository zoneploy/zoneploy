import { decrypt } from './crypto.js'
import { config } from '../config.js'
import type { servers } from '../db/schema.js'
import {
  buildAndDeployGitImage,
  cleanupLocalRuntime,
  clearLocalDeploymentRoutes,
  clearLocalStackRoutes,
  collectAuditReport,
  collectPreflightReport,
  createAgentStatus,
  createDeploymentSnapshot,
  detectHostRuntime,
  deployExternalImage,
  deployLocalGitStack,
  deployLocalStack,
  inspectLocalDeployment,
  inspectStackService,
  listStackServices,
  removeLocalDeployment,
  removeLocalStack,
  runDeploymentLifecycleAction,
  runStackLifecycleAction,
  runStackServiceLifecycleAction,
  syncLocalDeploymentRoutes,
  syncLocalStackRoutes,
} from '@zoneploy/runtime'

type Server = typeof servers.$inferSelect
type AgentAuthServer = Pick<
  Server,
  'agentMode' | 'agentTokenEncrypted' | 'agentTokenIv' | 'agentTokenAuthTag'
>

export interface PortMapping {
  port: number
  isPrimary: boolean
  zoneploySubdomains: string[]
  customDomains: string[]
}

export interface DeployOptions {
  containerId: string
  image: string
  port: number
  envVars: Record<string, string>
  platformDomain: string
  portMappings: PortMapping[]
  healthcheckPath?: string | null
  registryUser?: string
  registryPassword?: string
}

export interface GitBuildSource {
  repository: string
  ref?: string
  commitSha?: string
  token?: string
  contextPath?: string
  dockerfile?: string
  composeFile?: string
}

export interface GitDeployOptions extends Omit<DeployOptions, 'image' | 'registryUser' | 'registryPassword'> {
  git: GitBuildSource
  releaseId?: string
}

export interface DeployResult {
  dockerId: string
  imageDigest: string
  containerName: string
}

export interface GitDeployResult extends DeployResult {
  image: string
  releaseId: string
}

export interface StackServiceRuntime {
  serviceName: string
  containerName: string
  dockerId: string
  status: string
}

export interface StackDomainMapping {
  id: string
  serviceName: string
  port: number
  zoneploySubdomains: string[]
  customDomains: string[]
  isPrimary: boolean
}

export interface ContainerRouteSyncOptions {
  containerId: string
  nameOrId: string
  platformDomain: string
  portMappings: PortMapping[]
}

export interface StackRouteSyncOptions {
  stackId: string
  projectName: string
  platformDomain: string
  domainMappings: StackDomainMapping[]
}

export interface StackDeployOptions extends StackRouteSyncOptions {
  composeContent: string
  envVars: Record<string, string>
  registryHost?: string
  registryUser?: string
  registryPassword?: string
}

export interface GitStackDeployOptions extends Omit<StackDeployOptions, 'registryHost' | 'registryUser' | 'registryPassword'> {
  git: GitBuildSource
  releaseId?: string
}

export interface GitStackDeployResult {
  services: string[]
  releaseId: string
  images: Record<string, string>
}

export interface AgentAddonState {
  slug: string
  status: 'installing' | 'active' | 'suspended' | 'error' | 'disabled'
  version: string | null
  config: Record<string, unknown>
  capabilities: Record<string, unknown>
  health: Record<string, unknown>
}

export interface AgentServerPreflightReport {
  checkedAt: string
  remoteUser: string
  runtimeInfo: Record<string, unknown>
  capabilities: Record<string, unknown>
  conflicts: Array<{
    code: string
    severity: 'error' | 'warning'
    message: string
    details: Record<string, unknown>
  }>
  ports: Array<{
    port: number
    protocol: 'tcp'
    available: boolean
    listeners: Array<{ processName: string | null; pid: number | null }>
  }>
  summary: {
    errors: number
    warnings: number
  }
}

export type AgentAuditStatus = 'pass' | 'warn' | 'fail' | 'info'

export interface AgentAuditReport {
  generatedAt: string
  hostname: string
  agentVersion: string
  os: {
    platform: string
    distroId: string | null
    distroLike: string[]
    kernel: string
    arch: string
  }
  sections: Array<{
    title: string
    checks: Array<{
      id: string
      status: AgentAuditStatus
      title: string
      message: string
      details?: Record<string, unknown>
    }>
  }>
  summary: Record<AgentAuditStatus, number>
}

export interface AgentDockerCleanupOptions {
  dryRun?: boolean
  olderThanHours?: number
  pruneStoppedContainers?: boolean
  pruneDanglingImages?: boolean
  pruneBuildCache?: boolean
  pruneUnusedNetworks?: boolean
}

export interface AgentDockerCleanupResult {
  dryRun: boolean
  olderThanHours: number
  totalReclaimedMb: number
  commands: Array<{
    label: string
    command: string
    args: string[]
    stdout: string
    stderr: string
    reclaimedMb: number
  }>
}

export interface AgentStackBackupVolume {
  name: string
  composeName: string | null
  archiveFile: string
  sizeBytes: number
}

export interface AgentStackBackupItem {
  id: string
  stackId: string
  projectName: string
  status: 'success' | 'failed'
  storage: 'local-vps'
  storagePath: string
  createdAt: string
  completedAt: string | null
  sizeBytes: number
  volumes: AgentStackBackupVolume[]
  errorMessage?: string
}

export type AgentStackBackupStorageTarget =
  | { provider: 'local-vps' }
  | {
      provider: 's3-compatible'
      endpoint: string
      bucket: string
      region: string
      accessKeyId: string
      secretAccessKey: string
      prefix?: string
      forcePathStyle?: boolean
    }

class WorkerClientError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkerClientError'
  }
}

export function getAgentAuthToken(server: AgentAuthServer): string {
  if (server.agentMode === 'self_hosted' && config.ZONEPLOY_AGENT_API_TOKEN) {
    return config.ZONEPLOY_AGENT_API_TOKEN
  }

  return decrypt({
    encrypted: server.agentTokenEncrypted,
    iv: server.agentTokenIv,
    authTag: server.agentTokenAuthTag,
  })
}

function getAgentPort(server: Pick<Server, 'agentPort'>) {
  return server.agentPort || 4000
}

function getAgentHost(server: Pick<Server, 'ipAddress' | 'agentMode'>) {
  return server.agentMode === 'self_hosted' ? config.LOCAL_AGENT_HOST : server.ipAddress
}

function getEffectiveAgentPort(server: Pick<Server, 'agentMode' | 'agentPort'>) {
  return server.agentMode === 'self_hosted' ? config.LOCAL_AGENT_PORT : getAgentPort(server)
}

export function getAgentHttpUrl(server: Pick<Server, 'ipAddress' | 'agentPort' | 'agentMode'>, path = '') {
  return `http://${getAgentHost(server)}:${getEffectiveAgentPort(server)}${path}`
}

export function getAgentWsUrl(server: Pick<Server, 'ipAddress' | 'agentPort' | 'agentMode'>, path = '') {
  return `ws://${getAgentHost(server)}:${getEffectiveAgentPort(server)}${path}`
}

async function agentRequest<T>(
  server: Server,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getAgentAuthToken(server)
  const url = getAgentHttpUrl(server, path)

  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const errorPayload = (data as {
      error?:
        | string
        | {
            code?: string
            message?: string
          }
    }).error

    const code = typeof errorPayload === 'object' && errorPayload !== null
      ? errorPayload.code ?? 'AGENT_ERROR'
      : 'AGENT_ERROR'

    const message = typeof errorPayload === 'object' && errorPayload !== null
      ? errorPayload.message ?? 'Agent request failed'
      : errorPayload ?? 'Agent request failed'

    throw new WorkerClientError(response.status, code, message)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const workerClient = {
  deploy: (_server: Server, opts: DeployOptions) => deployExternalImage(opts),

  stopContainer: (_server: Server, nameOrId: string) =>
    removeLocalDeployment({ deploymentName: nameOrId }).then(() => undefined),

  listContainers: async (_server: Server) => {
    const snapshot = await createDeploymentSnapshot()
    return snapshot.deployments.map(deployment => ({
      id: deployment.containerId ?? deployment.id,
      name: deployment.name,
      status: deployment.status,
    }))
  },

  getStats: async (_server: Server) => {
    createAgentStatus({ agentVersion: 'local', mode: 'standalone' })
    const runtime = await detectHostRuntime()
    return {
      server: {
        cpuPercent: 0,
        memoryUsedMb: 0,
        memoryTotalMb: Number(runtime.totalMemoryMb ?? 0),
        storageUsedMb: 0,
        storageTotalMb: Number(runtime.totalStorageMb ?? 0),
        cpuCores: Number(runtime.totalCpuCores ?? 0),
      },
      containers: [],
    }
  },

  audit: async (_server: Server) => collectAuditReport({ agentVersion: 'local' }),

  dockerCleanup: async (_server: Server, options: AgentDockerCleanupOptions) => {
    const result = await cleanupLocalRuntime(options.dryRun !== false)
    return {
      dryRun: result.dryRun,
      olderThanHours: options.olderThanHours ?? 0,
      totalReclaimedMb: 0,
      commands: [],
    } satisfies AgentDockerCleanupResult
  },

  startContainer: (_server: Server, nameOrId: string) =>
    runDeploymentLifecycleAction('start', { deploymentName: nameOrId }).then(() => undefined),

  pauseContainer: (_server: Server, nameOrId: string) =>
    runDeploymentLifecycleAction('stop', { deploymentName: nameOrId }).then(() => undefined),

  restartContainer: (_server: Server, nameOrId: string) =>
    runDeploymentLifecycleAction('restart', { deploymentName: nameOrId }).then(() => undefined),

  syncContainerRoutes: (_server: Server, opts: ContainerRouteSyncOptions) =>
    syncLocalDeploymentRoutes(opts).then(() => undefined),

  clearContainerRoutes: (_server: Server, containerId: string) =>
    clearLocalDeploymentRoutes({ containerId }).then(() => undefined),

  inspectContainer: (_server: Server, nameOrId: string) => inspectLocalDeployment(nameOrId),

  listFiles: async (_server: Server, _nameOrId: string, _path: string) => [],

  cleanupVolume: async (_server: Server, _volumePath: string) => undefined,

  pushCert: async (_server: Server, _cert: string, _key: string) => undefined,

  decommission: async (_server: Server) => ({ ok: true }),

  isAgentReachable: async (_server: Server) => true,

  deployStack: (_server: Server, opts: StackDeployOptions) => deployLocalStack(opts),

  buildAndDeploy: (_server: Server, opts: GitDeployOptions) => buildAndDeployGitImage(opts),

  buildAndDeployStack: (_server: Server, opts: GitStackDeployOptions) => deployLocalGitStack(opts),

  listStackServices: (_server: Server, stackId: string, projectName: string) =>
    listStackServices({ stackId, projectName }),

  startStack: (_server: Server, stackId: string, projectName: string) =>
    runStackLifecycleAction('start', { stackId, projectName }),

  stopStack: (_server: Server, stackId: string, projectName: string) =>
    runStackLifecycleAction('stop', { stackId, projectName }),

  purgeStackRuntime: (_server: Server, stackId: string, projectName: string) =>
    removeLocalStack({ stackId, projectName }).then(() => undefined),

  restartStack: (_server: Server, stackId: string, projectName: string) =>
    runStackLifecycleAction('restart', { stackId, projectName }),

  syncStackRoutes: (_server: Server, opts: StackRouteSyncOptions) =>
    syncLocalStackRoutes(opts).then(() => undefined),

  clearStackRoutes: (_server: Server, stackId: string, projectName: string) =>
    clearLocalStackRoutes({ stackId, projectName }).then(() => undefined),

  listStackBackups: async (_server: Server, _stackId: string, _projectName: string) => [] as AgentStackBackupItem[],

  createStackBackup: async (_server: Server, stackId: string, projectName: string, _options?: unknown) => ({
    id: `${stackId}-${Date.now()}`,
    stackId,
    projectName,
    status: 'failed',
    storage: 'local-vps',
    storagePath: '',
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    sizeBytes: 0,
    volumes: [],
    errorMessage: 'Stack backups are not implemented in the local runtime yet.',
  }) satisfies AgentStackBackupItem,

  restoreStackBackup: async (_server: Server, stackId: string, projectName: string, backupId: string, _options?: unknown) => ({
    id: backupId,
    stackId,
    projectName,
    status: 'failed',
    storage: 'local-vps',
    storagePath: '',
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    sizeBytes: 0,
    volumes: [],
    errorMessage: 'Stack restore is not implemented in the local runtime yet.',
  }) satisfies AgentStackBackupItem,

  deleteStackBackup: async (_server: Server, _stackId: string, _projectName: string, backupId: string) => ({ id: backupId }),

  startStackService: (_server: Server, stackId: string, projectName: string, serviceName: string) =>
    runStackServiceLifecycleAction('start', { stackId, projectName, serviceName }),

  stopStackService: (_server: Server, stackId: string, projectName: string, serviceName: string) =>
    runStackServiceLifecycleAction('stop', { stackId, projectName, serviceName }),

  restartStackService: (_server: Server, stackId: string, projectName: string, serviceName: string) =>
    runStackServiceLifecycleAction('restart', { stackId, projectName, serviceName }),

  currentStackServiceMetrics: async (_server: Server, _stackId: string, _projectName: string, _serviceName: string) => ({
    cpuPercent: 0,
    memoryUsedMb: 0,
    diskReadMb: 0,
    diskWriteMb: 0,
    netRxMb: 0,
    netTxMb: 0,
    status: 'unknown',
    recordedAt: new Date().toISOString(),
  }),

  inspectStackService: (_server: Server, stackId: string, projectName: string, serviceName: string) =>
    inspectStackService({ stackId, projectName, serviceName }),

  listStackServiceFiles: async (_server: Server, _stackId: string, _projectName: string, _serviceName: string, _path: string) => [],

  getAddonStatus: async (_server: Server, slug: string) => ({
    slug,
    status: 'active',
    version: null,
    config: {},
    capabilities: {},
    health: {},
  }) satisfies AgentAddonState,

  getServerPreflight: async (_server: Server) => collectPreflightReport(),

  installAddon: async (_server: Server, slug: string, addonConfig: Record<string, unknown>) => ({
    slug,
    status: 'active',
    version: null,
    config: addonConfig,
    capabilities: {},
    health: {},
  }) satisfies AgentAddonState,

  configureAddon: async (_server: Server, slug: string, addonConfig: Record<string, unknown>) => ({
    slug,
    status: 'active',
    version: null,
    config: addonConfig,
    capabilities: {},
    health: {},
  }) satisfies AgentAddonState,

  runAddonAction: async (_server: Server, slug: string, _action: string, payload: Record<string, unknown>) => ({
    slug,
    status: 'active',
    version: null,
    config: payload,
    capabilities: {},
    health: {},
  }) satisfies AgentAddonState,

  uninstallAddon: async (_server: Server, slug: string) => ({
    slug,
    status: 'disabled',
    version: null,
    config: {},
    capabilities: {},
    health: {},
  }) satisfies AgentAddonState,
}

export { WorkerClientError }
