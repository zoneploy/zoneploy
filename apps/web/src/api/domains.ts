import { apiClient } from '@/lib/api-client'

export interface DomainInfo {
  hostname: string
  kind: 'custom'
  verified: boolean
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
  routingMode: 'server' | 'disabled'
  createdAt: string
  updatedAt: string
}

export interface CustomRoutingInfo {
  mode: 'server' | 'disabled'
  enabled: boolean
  serverId: string | null
  dnsTarget: string
  dnsRecordType: 'A' | 'AAAA' | 'CNAME' | null
}

export interface ContainerDomainsResponse {
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
