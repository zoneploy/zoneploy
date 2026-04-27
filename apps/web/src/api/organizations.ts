import { apiClient } from '@/lib/api-client'

export interface OrgDetail {
  id: string
  name: string
  slug: string
  ownerId: string
  billingCountry: 'AR' | 'US' | null
  logoUrl: string | null
  status: string
  require2fa: boolean
  role: string
  customRoleId: string | null
  permissions: import('@zoneploy/types').Permission[]
  createdAt: string
  subscription: {
    id: string
    status: string
    currentPeriodEnd: string
    planName: string
    planSlug: string
    planMaxServers: number
    planMaxDeployments: number
    planMaxSubdomains: number
    planMaxCustomDomains: number
    planMaxInstalledAddOns: number
  } | null
}

export interface OrgSummary {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  require2fa: boolean
  role: string
  customRoleId: string | null
  permissions: import('@zoneploy/types').Permission[]
  joinedAt: string
}

export const organizationsApi = {
  create: (data: { name: string }) =>
    apiClient.post<OrgDetail>('/organizations', data),

  list: () =>
    apiClient.get<OrgSummary[]>('/organizations'),

  get: (orgId: string) =>
    apiClient.get<OrgDetail>(`/organizations/${orgId}`),

  update: (orgId: string, data: { name?: string; require2fa?: boolean; billingCountry?: 'AR' | 'US' | null }) =>
    apiClient.patch<OrgDetail>(`/organizations/${orgId}`, data),

  uploadLogo: (orgId: string, file: File) => {
    const formData = new FormData()
    formData.append('logo', file)
    return apiClient.post<{ logoUrl: string }>(`/organizations/${orgId}/logo`, formData)
  },

  deleteLogo: (orgId: string) =>
    apiClient.delete(`/organizations/${orgId}/logo`),

  delete: (orgId: string) =>
    apiClient.delete(`/organizations/${orgId}`),
}
