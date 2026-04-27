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

export interface Invitation {
  id: string
  email: string
  role: OrgRole
  customRoleId: string | null
  customRoleName: string | null
  status: string
  expiresAt: string
  createdAt: string
}

export const membersApi = {
  list: (orgId: string) =>
    apiClient.get<Member[]>(`/organizations/${orgId}/members`),

  changeRole: (orgId: string, userId: string, data: { role: Exclude<OrgRole, 'owner'>; customRoleId?: string }) =>
    apiClient.patch(`/organizations/${orgId}/members/${userId}`, data),

  remove: (orgId: string, userId: string) =>
    apiClient.delete(`/organizations/${orgId}/members/${userId}`),

  transferOwnership: (orgId: string, newOwnerId: string) =>
    apiClient.post(`/organizations/${orgId}/members/transfer`, { newOwnerId }),

  listInvitations: (orgId: string) =>
    apiClient.get<Invitation[]>(`/organizations/${orgId}/invitations`),

  invite: (orgId: string, data: { email: string; role: Exclude<OrgRole, 'owner'>; customRoleId?: string }) =>
    apiClient.post<Invitation>(`/organizations/${orgId}/invitations`, data),

  revokeInvitation: (orgId: string, invitationId: string) =>
    apiClient.delete(`/organizations/${orgId}/invitations/${invitationId}`),
}

export const invitationsApi = {
  get: (token: string) =>
    apiClient.get<{
      id: string
      email: string
      role: OrgRole
      customRoleId: string | null
      customRoleName: string | null
      orgId: string
      orgName: string
      invitedByName: string
      expiresAt: string
    }>(`/invitations/${token}`),

  accept: (token: string) =>
    apiClient.post<{ orgId: string; orgName: string; orgSlug: string; orgRequire2fa: boolean; role: string; customRoleId: string | null; permissions: import('@zoneploy/types').Permission[] }>(
      `/invitations/${token}/accept`,
    ),

  decline: (token: string) =>
    apiClient.post<{ ok: boolean }>(`/invitations/${token}/decline`),
}
