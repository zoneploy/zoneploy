import { apiClient } from '@/lib/api-client'
import type { Permission } from '@zoneploy/types'

export interface CustomRole {
  id: string
  orgId: string
  name: string
  description: string | null
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}

export const customRolesApi = {
  list: (orgId: string) =>
    apiClient.get<CustomRole[]>(`/organizations/${orgId}/roles`),

  get: (orgId: string, roleId: string) =>
    apiClient.get<CustomRole>(`/organizations/${orgId}/roles/${roleId}`),

  create: (orgId: string, data: { name: string; description?: string; permissions: Permission[] }) =>
    apiClient.post<CustomRole>(`/organizations/${orgId}/roles`, data),

  update: (orgId: string, roleId: string, data: { name?: string; description?: string; permissions?: Permission[] }) =>
    apiClient.patch<CustomRole>(`/organizations/${orgId}/roles/${roleId}`, data),

  delete: (orgId: string, roleId: string) =>
    apiClient.delete(`/organizations/${orgId}/roles/${roleId}`),
}
