import { apiClient } from '@/lib/api-client'

export interface DomainInfo {
  hostname: string
  kind: 'zoneploy' | 'custom'
  verified: boolean
}

export interface ZoneployEndpointInfo {
  id: string
  containerId: string
  port: number
  slug: string
  hostnameLabel: string
  fullDomain: string
  isPrimary: boolean
  createdAt: string
  updatedAt: string
}

export interface CustomEndpointInfo {
  id: string
  containerId: string
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

export interface CustomRoutingInfo {
  mode: 'platform' | 'server-addon' | 'disabled'
  enabled: boolean
  addonSlug: string
  serverId: string | null
  installationId: string | null
  dnsTarget: string
  dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null
}

export interface ContainerDomainsResponse {
  zoneploy: ZoneployEndpointInfo[]
  custom: CustomEndpointInfo[]
  customRouting: CustomRoutingInfo
}

export interface VerifyResult {
  customDomain: string
  verified: boolean
  dnsTarget: string
  dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null
  instructions: string
}

export const domainsApi = {
  get: (orgId: string, containerId: string) =>
    apiClient.get<DomainInfo | null>(`/organizations/${orgId}/containers/${containerId}/domain`),

  listAll: (orgId: string, containerId: string) =>
    apiClient.get<ContainerDomainsResponse>(`/organizations/${orgId}/containers/${containerId}/domain/all`),

  addZoneploy: (orgId: string, containerId: string, port: number) =>
    apiClient.post<ZoneployEndpointInfo>(`/organizations/${orgId}/containers/${containerId}/domain/zoneploy`, { port }),

  updateZoneploy: (orgId: string, containerId: string, endpointId: string, updates: { port?: number; slug?: string }) =>
    apiClient.patch<ZoneployEndpointInfo>(
      `/organizations/${orgId}/containers/${containerId}/domain/zoneploy/${endpointId}`,
      updates,
    ),

  removeZoneploy: (orgId: string, containerId: string, endpointId: string) =>
    apiClient.delete(`/organizations/${orgId}/containers/${containerId}/domain/zoneploy/${endpointId}`),

  addCustom: (orgId: string, containerId: string, payload: { port: number; customDomain: string }) =>
    apiClient.post<CustomEndpointInfo>(`/organizations/${orgId}/containers/${containerId}/domain/custom`, payload),

  updateCustom: (orgId: string, containerId: string, endpointId: string, updates: { port?: number; customDomain?: string }) =>
    apiClient.patch<CustomEndpointInfo>(
      `/organizations/${orgId}/containers/${containerId}/domain/custom/${endpointId}`,
      updates,
    ),

  removeCustom: (orgId: string, containerId: string, endpointId: string) =>
    apiClient.delete(`/organizations/${orgId}/containers/${containerId}/domain/custom/${endpointId}`),

  verify: (orgId: string, containerId: string, endpointId: string) =>
    apiClient.post<VerifyResult>(
      `/organizations/${orgId}/containers/${containerId}/domain/custom/${endpointId}/verify`,
    ),
}
