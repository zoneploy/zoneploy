import { apiClient } from '@/lib/api-client'
import type { ServerItem } from '@/api/servers'

export interface OrgAddon {
  addOnId: string
  name: string
  slug: string
  description: string
  category: string
  controlPlane: 'agent' | 'platform' | 'external'
  installationScope: 'server'
  bindingScopes: Array<'container' | 'stack'>
  capabilities: Record<string, unknown>
  requirements: {
    requiredCapabilities: string[]
    freeTcpPorts: number[]
  }
  managedComponents: Array<{
    name: string
    kind: 'package' | 'service' | 'container' | 'firewall' | 'proxy' | 'certificate' | 'runtime'
  }>
  uiMetadata: {
    iconKey?: string
    logoKey?: string
    accentColor?: string
    summary?: string
  }
  limits: Record<string, unknown>
}

export interface ServerAddonInstallation {
  id: string
  serverId: string
  orgId: string
  addOnId: string
  name: string
  slug: string
  description: string
  category: string
  controlPlane: 'agent' | 'platform' | 'external'
  installationScope: 'server'
  bindingScopes: Array<'container' | 'stack'>
  requirements: {
    requiredCapabilities: string[]
    freeTcpPorts: number[]
  }
  managedComponents: OrgAddon['managedComponents']
  uiMetadata: OrgAddon['uiMetadata']
  status: 'installing' | 'active' | 'suspended' | 'error' | 'disabled'
  version: string | null
  config: Record<string, unknown>
  capabilities: Record<string, unknown>
  health: Record<string, unknown>
  bindingCount: number
  createdAt: string
  updatedAt: string
}

export interface ServerAddonsResponse {
  server: ServerItem
  installations: ServerAddonInstallation[]
}

export const addonsApi = {
  listOrg: (orgId: string) =>
    apiClient.get<OrgAddon[]>(`/organizations/${orgId}/addons`),

  listServer: (orgId: string, serverId: string) =>
    apiClient.get<ServerAddonsResponse>(`/organizations/${orgId}/servers/${serverId}/addons`),

  installOnServer: (orgId: string, serverId: string, addonId: string) =>
    apiClient.post(`/organizations/${orgId}/servers/${serverId}/addons/${addonId}`),

  configureServer: (orgId: string, serverId: string, addonId: string, config: Record<string, unknown>) =>
    apiClient.patch(`/organizations/${orgId}/servers/${serverId}/addons/${addonId}`, config),

  runServerAction: (orgId: string, serverId: string, addonId: string, action: string, payload: Record<string, unknown>) =>
    apiClient.post(`/organizations/${orgId}/servers/${serverId}/addons/${addonId}/actions/${action}`, payload),

  uninstallFromServer: (orgId: string, serverId: string, addonId: string, force = false) =>
    apiClient.delete<void>(`/organizations/${orgId}/servers/${serverId}/addons/${addonId}${force ? '?force=true' : ''}`),
}
