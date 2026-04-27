import { apiClient } from '@/lib/api-client'
import type { AuthResponse, AuthSessionResponse } from '@zoneploy/types'
import type { RegisterInput, LoginInput } from '@zoneploy/types'

export const authApi = {
  setupStatus: () =>
    apiClient.get<{ ownerConfigured: boolean; requiresOwnerSetup: boolean }>('/auth/setup-status'),

  setupOwner: (input: RegisterInput) =>
    apiClient.post<AuthSessionResponse>('/auth/setup-owner', input),

  login: (input: LoginInput) =>
    apiClient.post<AuthResponse>('/auth/login', input),

  refresh: () =>
    apiClient.post<AuthSessionResponse>('/auth/refresh'),

  session: () =>
    apiClient.get<AuthSessionResponse>('/auth/session'),

  logout: () =>
    apiClient.post<void>('/auth/logout'),

  me: () =>
    apiClient.get<{ id: string; email: string; fullName: string; avatarUrl: string | null }>('/auth/me'),
}
