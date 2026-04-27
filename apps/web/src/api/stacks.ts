import { apiClient } from '@/lib/api-client'
import type { CreateStackInput, UpdateStackInput } from '@zoneploy/types'

export interface StackItem {
  id: string
  orgId: string
  environmentId: string | null
  serverId: string | null
  name: string
  slug: string
  projectName: string
  projectDisplayName?: string | null
  environmentName?: string | null
  composeContent: string | null
  status: 'created' | 'deploying' | 'running' | 'partial' | 'stopped' | 'error'
  errorReason: string | null
  hasDeployToken: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface StackServiceItem {
  serviceName: string
  containerName: string
  dockerId: string
  status: 'running' | 'stopped' | 'restarting' | 'unknown'
  rawStatus: string
}

export interface StackDeploymentItem {
  id: string
  stackId: string
  orgId: string
  serverId: string
  composeSnapshot: string
  secretKeysSnapshot: string[]
  status: 'pending' | 'running' | 'success' | 'failed'
  triggeredBy: string
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
  createdAt: string
}

export interface StackServiceMetricsPoint {
  cpuPercent: number
  memoryUsedMb: number
  diskReadMb: number
  diskWriteMb: number
  netRxMb: number
  netTxMb: number
  recordedAt: string
}

export interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'link'
  size: number
  permissions: string
}

export interface StackSecretKey {
  id: string
  key: string
  createdAt: string
  updatedAt: string
}

export interface StackZoneployEndpointInfo {
  id: string
  stackId: string
  resolvedServiceName?: string | null
  portResolved?: boolean
  port: number
  slug: string
  hostnameLabel: string
  fullDomain: string
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export interface StackCustomEndpointInfo {
  id: string
  stackId: string
  resolvedServiceName?: string | null
  portResolved?: boolean
  port: number
  hostname: string
  verified: boolean
  isPrimary: boolean
  dnsTarget: string
  dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null
  routingMode: 'platform' | 'server-addon' | 'disabled'
  createdAt: string
  updatedAt: string
}

export interface StackCustomRoutingInfo {
  mode: 'platform' | 'server-addon' | 'disabled'
  enabled: boolean
  addonSlug: string
  serverId: string | null
  installationId: string | null
  dnsTarget: string
  dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null
}

export interface StackDomainsResponse {
  zoneploy: StackZoneployEndpointInfo[]
  custom: StackCustomEndpointInfo[]
  customRouting: StackCustomRoutingInfo
}

export interface StackBackupVolume {
  name: string
  composeName: string | null
  archiveFile: string
  sizeBytes: number
}

export interface StackBackupItem {
  id: string
  stackId: string
  projectName: string
  status: 'success' | 'failed'
  storage: 'local-vps'
  storagePath: string
  createdAt: string
  completedAt: string | null
  sizeBytes: number
  volumes: StackBackupVolume[]
  errorMessage?: string
}

export interface StackBackupPolicy {
  id: string | null
  stackId: string
  orgId: string
  enabled: boolean
  intervalHours: number
  retentionCount: number
  storageProvider: 'local-vps' | 's3-compatible'
  storageConfig: {
    endpoint: string
    bucket: string
    region: string
    prefix: string
    forcePathStyle: boolean
    accessKeyIdConfigured: boolean
    secretAccessKeyConfigured: boolean
  }
  lastRunAt: string | null
  nextRunAt: string | null
  lastStatus: 'never' | 'success' | 'failed'
  lastError: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface UpdateStackBackupPolicyInput {
  enabled?: boolean
  intervalHours?: number
  retentionCount?: number
  storageProvider?: 'local-vps' | 's3-compatible'
  storageConfig?: {
    endpoint?: string
    bucket?: string
    region?: string
    prefix?: string
    forcePathStyle?: boolean
    accessKeyId?: string
    secretAccessKey?: string
  }
}

export const stacksApi = {
  list: (orgId: string) =>
    apiClient.get<StackItem[]>(`/organizations/${orgId}/stacks`),

  get: (orgId: string, stackId: string) =>
    apiClient.get<StackItem>(`/organizations/${orgId}/stacks/${stackId}`),

  listDeployments: (orgId: string, stackId: string, page = 1) =>
    apiClient.get<{
      data: StackDeploymentItem[]
      meta: { total: number; page: number; limit: number; totalPages: number }
    }>(`/organizations/${orgId}/stacks/${stackId}/deployments?page=${page}`),

  create: (orgId: string, data: CreateStackInput) =>
    apiClient.post<StackItem & { deployToken: string }>(`/organizations/${orgId}/stacks`, data),

  update: (orgId: string, stackId: string, data: UpdateStackInput) =>
    apiClient.patch<StackItem>(`/organizations/${orgId}/stacks/${stackId}`, data),

  delete: (orgId: string, stackId: string) =>
    apiClient.delete(`/organizations/${orgId}/stacks/${stackId}`),

  deploy: (orgId: string, stackId: string, composeContent: string) =>
    apiClient.post<{ deploymentId: string; status: string }>(
      `/organizations/${orgId}/stacks/${stackId}/deploy`,
      composeContent,
    ),

  start: (orgId: string, stackId: string) =>
    apiClient.post<void>(`/organizations/${orgId}/stacks/${stackId}/start`),

  stop: (orgId: string, stackId: string) =>
    apiClient.post<void>(`/organizations/${orgId}/stacks/${stackId}/stop`),

  restart: (orgId: string, stackId: string) =>
    apiClient.post<void>(`/organizations/${orgId}/stacks/${stackId}/restart`),

  listBackups: (orgId: string, stackId: string) =>
    apiClient.get<StackBackupItem[]>(`/organizations/${orgId}/stacks/${stackId}/backups`),

  getBackupPolicy: (orgId: string, stackId: string) =>
    apiClient.get<StackBackupPolicy>(`/organizations/${orgId}/stacks/${stackId}/backups/policy`),

  updateBackupPolicy: (orgId: string, stackId: string, data: UpdateStackBackupPolicyInput) =>
    apiClient.patch<StackBackupPolicy>(`/organizations/${orgId}/stacks/${stackId}/backups/policy`, data),

  createBackup: (orgId: string, stackId: string, retentionCount = 5) =>
    apiClient.post<StackBackupItem>(`/organizations/${orgId}/stacks/${stackId}/backups`, { retentionCount }),

  restoreBackup: (orgId: string, stackId: string, backupId: string, restartAfterRestore = true) =>
    apiClient.post<StackBackupItem>(
      `/organizations/${orgId}/stacks/${stackId}/backups/${encodeURIComponent(backupId)}/restore`,
      { restartAfterRestore },
    ),

  deleteBackup: (orgId: string, stackId: string, backupId: string) =>
    apiClient.delete<void>(`/organizations/${orgId}/stacks/${stackId}/backups/${encodeURIComponent(backupId)}`),

  listServices: (orgId: string, stackId: string) =>
    apiClient.get<StackServiceItem[]>(`/organizations/${orgId}/stacks/${stackId}/services`),

  startService: (orgId: string, stackId: string, serviceName: string) =>
    apiClient.post<void>(`/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/start`),

  stopService: (orgId: string, stackId: string, serviceName: string) =>
    apiClient.post<void>(`/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/stop`),

  restartService: (orgId: string, stackId: string, serviceName: string) =>
    apiClient.post<void>(`/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/restart`),

  inspectService: (orgId: string, stackId: string, serviceName: string) =>
    apiClient.get<unknown>(`/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/inspect`),

  listServiceFiles: (orgId: string, stackId: string, serviceName: string, path: string) =>
    apiClient.get<FileEntry[]>(
      `/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/files?path=${encodeURIComponent(path)}`,
    ),

  currentMetrics: (orgId: string, stackId: string, serviceName: string) =>
    apiClient.get<(StackServiceMetricsPoint & { status: string }) | null>(
      `/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/metrics/current`,
    ),

  metricsHistory: (orgId: string, stackId: string, serviceName: string, period: '1h' | '6h' | '24h') =>
    apiClient.get<StackServiceMetricsPoint[]>(
      `/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/metrics/history?period=${period}`,
    ),

  listSecrets: (orgId: string, stackId: string) =>
    apiClient.get<StackSecretKey[]>(`/organizations/${orgId}/stacks/${stackId}/secrets`),

  upsertSecret: (orgId: string, stackId: string, key: string, value: string) =>
    apiClient.put<void>(`/organizations/${orgId}/stacks/${stackId}/secrets/${key}`, { value }),

  deleteSecret: (orgId: string, stackId: string, key: string) =>
    apiClient.delete(`/organizations/${orgId}/stacks/${stackId}/secrets/${key}`),

  listDomains: (orgId: string, stackId: string) =>
    apiClient.get<StackDomainsResponse>(`/organizations/${orgId}/stacks/${stackId}/domains`),

  addZoneployDomain: (orgId: string, stackId: string, port: number) =>
    apiClient.post<StackZoneployEndpointInfo>(`/organizations/${orgId}/stacks/${stackId}/domains/zoneploy`, { port }),

  updateZoneployDomain: (orgId: string, stackId: string, endpointId: string, updates: { port?: number; slug?: string }) =>
    apiClient.patch<StackZoneployEndpointInfo>(`/organizations/${orgId}/stacks/${stackId}/domains/zoneploy/${endpointId}`, updates),

  removeZoneployDomain: (orgId: string, stackId: string, endpointId: string) =>
    apiClient.delete(`/organizations/${orgId}/stacks/${stackId}/domains/zoneploy/${endpointId}`),

  addCustomDomain: (orgId: string, stackId: string, payload: { port: number; customDomain: string }) =>
    apiClient.post<StackCustomEndpointInfo>(`/organizations/${orgId}/stacks/${stackId}/domains/custom`, payload),

  updateCustomDomain: (orgId: string, stackId: string, endpointId: string, updates: { port?: number; customDomain?: string }) =>
    apiClient.patch<StackCustomEndpointInfo>(`/organizations/${orgId}/stacks/${stackId}/domains/custom/${endpointId}`, updates),

  removeCustomDomain: (orgId: string, stackId: string, endpointId: string) =>
    apiClient.delete<void>(`/organizations/${orgId}/stacks/${stackId}/domains/custom/${endpointId}`),

  verifyCustomDomain: (orgId: string, stackId: string, endpointId: string) =>
    apiClient.post<{ verified: boolean; dnsTarget: string; dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null; instructions: string }>(`/organizations/${orgId}/stacks/${stackId}/domains/custom/${endpointId}/verify`),

  metricsLiveUrl: (orgId: string, stackId: string, serviceName: string, token: string) => {
    const base = (import.meta as any).env?.VITE_API_URL ?? '/api/v1'
    return `${base}/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/metrics/live?token=${encodeURIComponent(token)}`
  },

  generateDeployToken: (orgId: string, stackId: string) =>
    apiClient.post<{ token: string }>(`/organizations/${orgId}/stacks/${stackId}/deploy-token`),

  revokeDeployToken: (orgId: string, stackId: string) =>
    apiClient.delete<void>(`/organizations/${orgId}/stacks/${stackId}/deploy-token`),

  logsUrl: (orgId: string, stackId: string, serviceName: string) => {
    const base = import.meta.env.VITE_API_URL ?? '/api/v1'
    return `${base}/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/logs`
  },

  terminalWsUrl: (orgId: string, stackId: string, serviceName: string) => {
    const apiUrl = (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/api\/v1\/?$/, '')
    const wsUrl = apiUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
    return `${wsUrl}/api/v1/organizations/${orgId}/stacks/${stackId}/services/${encodeURIComponent(serviceName)}/terminal`
  },
}
