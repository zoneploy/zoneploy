import { apiClient } from '@/lib/api-client'
import type { OrgRole } from '@zoneploy/types'

export interface Member {
  id: string
  role: OrgRole
  customRoleId: string | null
  customRoleName: string | null
  joinedAt: string
  userId: string
  userEmail: string
  userFullName: string
  userAvatarUrl: string | null
  twoFactorEnabled: boolean
}

export const membersApi = {
  list: (orgId: string) =>
    apiClient.get<Member[]>(`/organizations/${orgId}/members`),

  create: (orgId: string, data: { fullName: string; email: string; password: string; role: Exclude<OrgRole, 'owner'>; customRoleId?: string }) =>
    apiClient.post<Member>(`/organizations/${orgId}/members`, data),

  changeRole: (orgId: string, userId: string, data: { role: Exclude<OrgRole, 'owner'>; customRoleId?: string }) =>
    apiClient.patch(`/organizations/${orgId}/members/${userId}`, data),

  remove: (orgId: string, userId: string) =>
    apiClient.delete(`/organizations/${orgId}/members/${userId}`),

  transferOwnership: (orgId: string, newOwnerId: string) =>
    apiClient.post(`/organizations/${orgId}/members/transfer`, { newOwnerId }),
}
