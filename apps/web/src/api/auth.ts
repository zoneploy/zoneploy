import { apiClient } from '@/lib/api-client'
import type { AuthResponse, AuthSessionResponse, RegisterResponse } from '@zoneploy/types'
import type { RegisterInput, LoginInput } from '@zoneploy/types'

export const authApi = {
  setupStatus: () =>
    apiClient.get<{ ownerConfigured: boolean; requiresOwnerSetup: boolean }>('/auth/setup-status'),

  setupOwner: (input: RegisterInput) =>
    apiClient.post<AuthSessionResponse>('/auth/setup-owner', input),

  register: (input: RegisterInput) =>
    apiClient.post<RegisterResponse>('/auth/register', input),

  login: (input: LoginInput) =>
    apiClient.post<AuthResponse>('/auth/login', input),

  refresh: () =>
    apiClient.post<AuthSessionResponse>('/auth/refresh'),

  session: () =>
    apiClient.get<AuthSessionResponse>('/auth/session'),

  logout: () =>
    apiClient.post<void>('/auth/logout'),

  me: () =>
    apiClient.get<{ id: string; email: string; fullName: string; avatarUrl: string | null; emailVerified: boolean }>('/auth/me'),

  pendingInvitations: () =>
    apiClient.get<Array<{
      id: string
      token: string
      role: string
      customRoleId: string | null
      customRoleName: string | null
      expiresAt: string
      orgName: string
      invitedByName: string
    }>>('/auth/invitations/pending'),

  verifyEmail: (token: string) =>
    apiClient.post<{ ok: boolean }>('/auth/verify-email', { token }),

  resendVerification: (email: string, lang: string) =>
    apiClient.post<{ ok: boolean }>('/auth/resend-verification', { email, lang }),
}
