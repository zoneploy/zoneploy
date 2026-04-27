import { apiClient } from '@/lib/api-client'

export interface Environment {
  id: string
  projectId: string
  orgId: string
  name: string
  color: string | null
  isProtected: boolean
  createdAt: string
  updatedAt: string
}

export interface EnvSecret {
  key: string
  createdAt: string
}

export const environmentsApi = {
  list: (orgId: string, projectId: string) =>
    apiClient.get<Environment[]>(`/organizations/${orgId}/projects/${projectId}/environments`),

  get: (orgId: string, projectId: string, envId: string) =>
    apiClient.get<Environment>(`/organizations/${orgId}/projects/${projectId}/environments/${envId}`),

  create: (orgId: string, projectId: string, data: { name: string; color?: string; isProtected?: boolean }) =>
    apiClient.post<Environment>(`/organizations/${orgId}/projects/${projectId}/environments`, data),

  update: (orgId: string, projectId: string, envId: string, data: { name?: string; color?: string; isProtected?: boolean }) =>
    apiClient.patch<Environment>(`/organizations/${orgId}/projects/${projectId}/environments/${envId}`, data),

  delete: (orgId: string, projectId: string, envId: string) =>
    apiClient.delete(`/organizations/${orgId}/projects/${projectId}/environments/${envId}`),

  listSecrets: (orgId: string, projectId: string, envId: string) =>
    apiClient.get<EnvSecret[]>(`/organizations/${orgId}/projects/${projectId}/environments/${envId}/secrets`),

  upsertSecret: (orgId: string, projectId: string, envId: string, key: string, value: string) =>
    apiClient.put(`/organizations/${orgId}/projects/${projectId}/environments/${envId}/secrets/${key}`, { value }),

  deleteSecret: (orgId: string, projectId: string, envId: string, key: string) =>
    apiClient.delete(`/organizations/${orgId}/projects/${projectId}/environments/${envId}/secrets/${key}`),
}
