import { apiClient } from '@/lib/api-client'
import type { ServerPreflightConflict, ServerRuntimeInfo } from '@zoneploy/types'

export interface ServerCapabilities {
  linux: boolean
  rootAccess: boolean
  systemd: boolean
  packageManagerSupported: boolean
  dockerInstalled: boolean
  dockerRunning: boolean
  dockerSnapInstalled: boolean
  baseInstallReady: boolean
  ports: Record<string, {
    port: number
    protocol: 'tcp'
    available: boolean
    listeners: Array<{ processName: string | null; pid: number | null }>
  }>
}

export interface ServerItem {
  id: string
  orgId: string
  name: string
  ipAddress: string
  sshUser: string
  sshPort: number
  agentPort: number
  agentMode: 'legacy' | 'self_hosted'
  status: 'provisioning' | 'online' | 'offline' | 'error' | 'disconnecting' | 'updating'
  lastHeartbeatAt: string | null
  totalCpuCores: number | null
  totalMemoryMb: number | null
  totalStorageMb: number | null
  agentVersion: string | null
  runtimeInfo: ServerRuntimeInfo
  capabilities: ServerCapabilities
  conflicts: ServerPreflightConflict[]
  lastPreflightAt: string | null
  createdAt: string
  updatedAt: string
}

export type AgentAuditStatus = 'pass' | 'warn' | 'fail' | 'info'

export interface AgentAuditReport {
  generatedAt: string
  hostname: string
  agentVersion: string
  os?: {
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

export interface ServerDockerCleanupOptions {
  dryRun?: boolean
  olderThanHours?: number
  pruneStoppedContainers?: boolean
  pruneDanglingImages?: boolean
  pruneBuildCache?: boolean
  pruneUnusedNetworks?: boolean
}

export interface ServerDockerCleanupResult {
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

export const serversApi = {
  list: (orgId: string) =>
    apiClient.get<ServerItem[]>(`/organizations/${orgId}/servers`),

  get: (orgId: string, serverId: string) =>
    apiClient.get<ServerItem>(`/organizations/${orgId}/servers/${serverId}`),

  audit: (orgId: string, serverId: string) =>
    apiClient.post<AgentAuditReport>(`/organizations/${orgId}/servers/${serverId}/audit`),

  dockerCleanup: (orgId: string, serverId: string, options: ServerDockerCleanupOptions = {}) =>
    apiClient.post<ServerDockerCleanupResult>(`/organizations/${orgId}/servers/${serverId}/docker-cleanup`, options),

  terminalWsUrl: (orgId: string, serverId: string) => {
    const apiUrl = (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/api\/v1\/?$/, '')
    const wsUrl = apiUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
    return `${wsUrl}/api/v1/organizations/${orgId}/servers/${serverId}/terminal`
  },
}
