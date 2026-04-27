// Generic API responses

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

// Auth

// Public session/authentication payload; never exposes the refresh token.
export interface AuthSessionResponse {
  accessToken: string
  user: {
    id: string
    email: string
    fullName: string
    avatarUrl: string | null
    emailVerified: boolean
    totpEnabled: boolean
  }
  org: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    role: string
    customRoleId: string | null
    permissions: import('./enums.js').Permission[]
    require2fa: boolean
  } | null
}

// Successful login response when MFA is not required.
export interface AuthResponseSuccess extends AuthSessionResponse {
  requiresMfa?: false
}

// Registration response when email verification is still required.
export interface RegisterResponsePendingVerification {
  ok: true
  requiresEmailVerification: true
  email: string
}

export interface RegisterResponseReady {
  ok: true
  requiresEmailVerification: false
  email: string
}

// Respuesta de login que requiere MFA
export interface AuthResponseMfaRequired {
  requiresMfa: true
  mfaType: 'webauthn' | 'totp'
  tempToken: string
  user: {
    id: string
    email: string
    fullName: string
  }
}

// Respuesta de completar MFA (igual a AuthResponseSuccess)
export type AuthResponseMfaVerified = AuthSessionResponse

export type AuthResponse = AuthResponseSuccess | AuthResponseMfaRequired

// Session context stored on the client

export interface SessionContext {
  accessToken: string
  user: {
    id: string
    email: string
    fullName: string
    avatarUrl: string | null
    isPlatformAdmin: boolean
    emailVerified: boolean
    totpEnabled: boolean
  }
  org: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    role: import('./enums.js').OrgRole
    customRoleId: string | null
    permissions: import('./enums.js').Permission[]
    require2fa: boolean
  } | null
}

// Backward-compatible aliases.
export type LoginResponse = AuthResponse
export type RegisterResponse = RegisterResponsePendingVerification | RegisterResponseReady
