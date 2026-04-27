import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '@/api/auth'
import { organizationsApi } from '@/api/organizations'
import { toSessionContext } from '@/lib/auth-session'
import { useAuthStore } from '@/stores/auth'
import type { AuthResponseSuccess } from '@zoneploy/types'
import type { RegisterInput, LoginInput } from '@zoneploy/types'

export function getPostLoginPath(data: {
  org: { require2fa?: boolean; role?: string } | null
  user?: { totpEnabled?: boolean }
}) {
  const needsOrgMfaSetup = data.org?.require2fa && !data.user?.totpEnabled && data.org?.role !== 'owner'
  if (needsOrgMfaSetup) return '/security'
  return data.org ? '/projects' : '/dashboard'
}

export function useLogin() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSession = useAuthStore(s => s.setSession)
  const setPendingMfa = useAuthStore(s => s.setPendingMfa)

  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: data => {
      // Chequear si requiere MFA
      if ('requiresMfa' in data && data.requiresMfa) {
        setPendingMfa({
          type: data.mfaType,
          user: data.user,
        }, data.tempToken)
        // Do not navigate; LoginPage will show the MFA screen.
        return
      }

      // Login without MFA; store tokens.
      const successData = data as AuthResponseSuccess
      setSession(successData.accessToken, toSessionContext(successData))
      // Clear previous session cache to avoid cross-account data.
      queryClient.clear()
      // Prefetch org list during navigation transition so data is ready
      // when Sidebar mounts.
      queryClient.prefetchQuery({
        queryKey: ['organizations'],
        queryFn: organizationsApi.list,
        staleTime: 5 * 60_000,
      })

      // If the org requires 2FA and user does not have it yet, redirect to setup.
      navigate(getPostLoginPath(successData))
    },
  })
}

export function useSetupOwner() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSession = useAuthStore(s => s.setSession)
  const { i18n } = useTranslation()

  return useMutation<AuthResponseSuccess, unknown, Omit<RegisterInput, 'lang'>>({
    mutationFn: (input: Omit<RegisterInput, 'lang'>) =>
      authApi.setupOwner({ ...input, lang: i18n.language?.startsWith('en') ? 'en' : 'es' }) as Promise<AuthResponseSuccess>,
    onSuccess: data => {
      setSession(data.accessToken, toSessionContext(data))
      queryClient.clear()
      queryClient.prefetchQuery({
        queryKey: ['organizations'],
        queryFn: organizationsApi.list,
        staleTime: 5 * 60_000,
      })
      navigate(getPostLoginPath(data), { replace: true })
    },
  })
}

export function useLogout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const clearSession = useAuthStore(s => s.clearSession)

  return () => {
    authApi.logout().catch(() => null)
    clearSession()
    queryClient.clear()
    navigate('/login')
  }
}
