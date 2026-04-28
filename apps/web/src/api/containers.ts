import { apiClient } from '@/lib/api-client'
import type { CreateContainerInput, UpdateContainerInput } from '@zoneploy/types'

export interface ContainerItem {
  id: string
  orgId: string
  environmentId: string | null
  serverId: string | null
  name: string
  slug: string
  image: string | null
  port: number
  healthcheckPath: string | null
  status: 'waiting' | 'created' | 'deploying' | 'running' | 'stopped' | 'error'
  errorReason: string | null
  dockerId: string | null
  currentDeploymentId: string | null
  needsRedeploy: boolean
  hasDeployToken: boolean
  createdAt: string
  updatedAt: string
  serverName?: string | null
  environmentName?: string | null
  projectName?: string | null
  domain?: {
    hostname: string
    kind: 'custom'
    verified: boolean
  } | null
}

export interface DeploymentItem {
  id: string
  containerId: string
  serverId: string
  imageSnapshot: string
  status: 'pending' | 'running' | 'success' | 'failed'
  triggeredBy: string
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

export const containersApi = {
  list: (orgId: string) =>
    apiClient.get<ContainerItem[]>(`/organizations/${orgId}/containers`),

  get: (orgId: string, containerId: string) =>
    apiClient.get<ContainerItem>(`/organizations/${orgId}/containers/${containerId}`),

  create: (orgId: string, data: CreateContainerInput) =>
    apiClient.post<ContainerItem & { deployToken: string }>(`/organizations/${orgId}/containers`, data),

  update: (orgId: string, containerId: string, data: UpdateContainerInput) =>
    apiClient.patch<ContainerItem>(`/organizations/${orgId}/containers/${containerId}`, data),

  delete: (orgId: string, containerId: string) =>
    apiClient.delete(`/organizations/${orgId}/containers/${containerId}`),

  deploy: (orgId: string, containerId: string) =>
    apiClient.post<{ deploymentId: string; status: string }>(
      `/organizations/${orgId}/containers/${containerId}/deploy`,
    ),

  listDeployments: (orgId: string, containerId: string, page = 1) =>
    apiClient.get<{
      data: DeploymentItem[]
      meta: { total: number; page: number; limit: number; totalPages: number }
    }>(`/organizations/${orgId}/containers/${containerId}/deployments?page=${page}`),

  getDeployment: (orgId: string, deploymentId: string, containerId: string) =>
    apiClient.get<DeploymentItem>(
      `/organizations/${orgId}/containers/${containerId}/deployments/${deploymentId}`,
    ),

  rollback: (orgId: string, containerId: string, deploymentId: string) =>
    apiClient.post<{ deploymentId: string; status: string }>(
      `/organizations/${orgId}/containers/${containerId}/deployments/${deploymentId}/rollback`,
    ),

  currentMetrics: (orgId: string, containerId: string) =>
    apiClient.get<{ cpuPercent: number; memoryUsedMb: number; status: string; recordedAt: string } | null>(
      `/organizations/${orgId}/containers/${containerId}/metrics/current`,
    ),

  metricsHistory: (orgId: string, containerId: string, period: '1h' | '6h' | '24h') =>
    apiClient.get<Array<{ cpuPercent: number; memoryUsedMb: number; diskReadMb: number; diskWriteMb: number; netRxMb: number; netTxMb: number; recordedAt: string }>>(
      `/organizations/${orgId}/containers/${containerId}/metrics/history?period=${period}`,
    ),

  metricsLiveUrl: (orgId: string, containerId: string, token: string) => {
    const base = (import.meta as any).env?.VITE_API_URL ?? '/api/v1'
    return `${base}/organizations/${orgId}/containers/${containerId}/metrics/live?token=${encodeURIComponent(token)}`
  },

  terminalWsUrl: (orgId: string, containerId: string) => {
    const apiUrl = (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/api\/v1\/?$/, '')
    const wsUrl = apiUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
    return `${wsUrl}/api/v1/organizations/${orgId}/containers/${containerId}/terminal`
  },

  deployLogsUrl: (orgId: string, containerId: string, deploymentId: string) => {
    const base = import.meta.env.VITE_API_URL ?? '/api/v1'
    return `${base}/organizations/${orgId}/containers/${containerId}/deployments/${deploymentId}/stream`
  },

  start: (orgId: string, containerId: string) =>
    apiClient.post<void>(`/organizations/${orgId}/containers/${containerId}/start`),

  stop: (orgId: string, containerId: string) =>
    apiClient.post<void>(`/organizations/${orgId}/containers/${containerId}/stop`),

  restart: (orgId: string, containerId: string) =>
    apiClient.post<void>(`/organizations/${orgId}/containers/${containerId}/restart`),

  inspect: (orgId: string, containerId: string) =>
    apiClient.get<unknown>(`/organizations/${orgId}/containers/${containerId}/inspect`),

  generateDeployToken: (orgId: string, containerId: string) =>
    apiClient.post<{ token: string }>(`/organizations/${orgId}/containers/${containerId}/deploy-token`),

  revokeDeployToken: (orgId: string, containerId: string) =>
    apiClient.delete<void>(`/organizations/${orgId}/containers/${containerId}/deploy-token`),

  logsUrl: (orgId: string, containerId: string) => {
    const base = import.meta.env.VITE_API_URL ?? '/api/v1'
    return `${base}/organizations/${orgId}/containers/${containerId}/logs`
  },

  listFiles: (orgId: string, containerId: string, path: string) =>
    apiClient.get<FileEntry[]>(
      `/organizations/${orgId}/containers/${containerId}/files?path=${encodeURIComponent(path)}`,
    ),


}

export interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: number
  permissions: string
}
