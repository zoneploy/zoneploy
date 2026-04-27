import type { AuthSessionResponse } from '@zoneploy/types'
import { useAuthStore } from '@/stores/auth.js'
import { toSessionContext } from '@/lib/auth-session.js'

const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? '/api/v1'

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Decodes the JWT payload locally and returns true if the token is already
 * expired or will expire within the next 30 seconds.
 * This is not a security check; it only helps decide when to refresh.
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 30_000
  } catch {
    return true
  }
}

let refreshPromise: Promise<string | null> | null = null

function canAttemptRefresh(path: string): boolean {
  if (path === '/auth/login') return false
  if (path === '/auth/register') return false
  if (path === '/auth/setup-status') return false
  if (path === '/auth/setup-owner') return false
  if (path === '/auth/refresh') return false
  if (path === '/auth/session') return false
  if (path === '/auth/logout') return false
  if (path === '/auth/verify-email') return false
  if (path === '/auth/resend-verification') return false
  if (path.startsWith('/auth/oauth/')) return false
  if (path.startsWith('/auth/reset-password/')) return false
  return true
}

function forceLogout() {
  useAuthStore.getState().clearSession()
  window.location.href = '/login'
}

function applySessionPayload(data: AuthSessionResponse) {
  useAuthStore.getState().setSession(data.accessToken, toSessionContext(data))
}

async function parseError(response: Response): Promise<ApiError> {
  const data = await response.json().catch(() => ({}))
  return new ApiError(
    response.status,
    data?.error?.code ?? 'UNKNOWN_ERROR',
    data?.error?.message ?? 'Unknown error',
  )
}

export async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })

      if (res.status === 401) {
        forceLogout()
        return null
      }

      if (!res.ok) {
        throw await parseError(res)
      }

      const data = await res.json() as AuthSessionResponse
      applySessionPayload(data)
      return data.accessToken
    } catch (err) {
      if (err instanceof TypeError) throw err
      forceLogout()
      return null
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
}

export async function bootstrapSession(): Promise<AuthSessionResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/session`, {
      method: 'GET',
      credentials: 'include',
    })

    if (res.status === 401) {
      useAuthStore.getState().clearSession()
      return null
    }

    if (!res.ok) {
      throw await parseError(res)
    }

    const data = await res.json() as AuthSessionResponse
    applySessionPayload(data)
    return data
  } catch (err) {
    if (!(err instanceof TypeError)) {
      useAuthStore.getState().clearSession()
    }
    return null
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let token = useAuthStore.getState().accessToken
  const isFormData = body instanceof FormData
  const mayRefresh = canAttemptRefresh(path)

  if (token && isTokenExpired(token) && mayRefresh) {
    const refreshed = await tryRefreshToken()
    if (refreshed) token = refreshed
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
  })

  if (response.status === 401 && mayRefresh) {
    const newToken = await tryRefreshToken()
    if (!newToken) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Session expired')
    }

    const retried = await fetch(`${BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${newToken}`,
      },
      ...(body ? { body: isFormData ? body : JSON.stringify(body) } : {}),
    })

    if (!retried.ok) {
      if (retried.status === 401) {
        forceLogout()
        throw new ApiError(401, 'UNAUTHORIZED', 'Session expired')
      }
      throw await parseError(retried)
    }

    return parseBody<T>(retried)
  }

  if (!response.ok) {
    throw await parseError(response)
  }

  return parseBody<T>(response)
}

function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return Promise.resolve(null as T)
  }
  return response.json() as Promise<T>
}

export const apiClient = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export { ApiError }
