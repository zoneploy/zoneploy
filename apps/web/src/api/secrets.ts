import { apiClient } from '@/lib/api-client'

export interface SecretKey {
  id: string
  key: string
  createdAt: string
  updatedAt: string
}

export const secretsApi = {
  list: (orgId: string, containerId: string) =>
    apiClient.get<SecretKey[]>(`/organizations/${orgId}/containers/${containerId}/secrets`),

  upsert: (orgId: string, containerId: string, key: string, value: string) =>
    apiClient.put<SecretKey>(
      `/organizations/${orgId}/containers/${containerId}/secrets/${key}`,
      { value },
    ),

  delete: (orgId: string, containerId: string, key: string) =>
    apiClient.delete(`/organizations/${orgId}/containers/${containerId}/secrets/${key}`),
}
