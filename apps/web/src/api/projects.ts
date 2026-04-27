import { apiClient } from '@/lib/api-client'

export interface Project {
  id: string
  orgId: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

export const projectsApi = {
  list: (orgId: string) =>
    apiClient.get<Project[]>(`/organizations/${orgId}/projects`),

  get: (orgId: string, projectId: string) =>
    apiClient.get<Project>(`/organizations/${orgId}/projects/${projectId}`),

  create: (orgId: string, data: { name: string; description?: string }) =>
    apiClient.post<Project>(`/organizations/${orgId}/projects`, data),

  update: (orgId: string, projectId: string, data: { name?: string; description?: string }) =>
    apiClient.patch<Project>(`/organizations/${orgId}/projects/${projectId}`, data),

  delete: (orgId: string, projectId: string) =>
    apiClient.delete(`/organizations/${orgId}/projects/${projectId}`),
}
