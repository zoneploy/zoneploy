import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth'
import { apiClient, isTokenExpired, tryRefreshToken } from '@/lib/api-client'

/**
 * Guards all private routes.
 *
 * On mount (initial load or direct URL navigation):
 *   1. If there is no token, redirects to login immediately without spinner.
 *   2. If token is expired, silently refreshes before rendering.
 *   3. If token is valid, renders directly without a server request.
 *
 * Also listens to `visibilitychange`: when the user returns to the tab after
 * some time, checks whether the token expired while the app was in the background.
 * y lo renueva de forma transparente.
 */
// Routes always accessible, even when the org requires 2FA that is not configured yet.
const ORG_MFA_ALLOWED = ['/dashboard', '/security', '/profile', '/notifications', '/organizations']

export function ProtectedRoute() {
  const accessToken = useAuthStore(s => s.accessToken)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated())
  const session = useAuthStore(s => s.session)
  const location = useLocation()

  // Candidate for verification: org requires 2FA, no TOTP, not owner.
  const mightNeedMfa = !!(
    session?.org?.require2fa &&
    !session?.user?.totpEnabled &&
    session?.org?.role !== 'owner'
  )

  // Query passkeys only when applicable; TanStack cache avoids extra requests.
  const { data: passkeys, isLoading: passkeyLoading } = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => apiClient.get<unknown[]>('/auth/profile/passkeys'),
    enabled: mightNeedMfa,
    staleTime: 2 * 60 * 1000,
  })

  // Do not redirect while passkeys load to avoid incorrect flash.
  const requiresOrgMfa = mightNeedMfa && !passkeyLoading && (passkeys?.length ?? 0) === 0
  const [checking, setChecking] = useState(() => {
    // Solo muestra el spinner si hay token pero puede estar expirado.
    // If there is no token, redirect to login without flicker.
    return !!accessToken && isTokenExpired(accessToken)
  })

  useEffect(() => {
    if (!accessToken) return

    // If the token was expired on mount, checking=true is already active.
    // Start refresh and hide the spinner when it finishes.
    if (isTokenExpired(accessToken)) {
      tryRefreshToken()
        .catch(() => null)
        .finally(() => setChecking(false))
      return
    }

    // Valid token on mount; no spinner needed.
    setChecking(false)
  }, []) // Solo al montar

  useEffect(() => {
    if (!accessToken) return

    // When the user returns to the tab, check whether the token expired
    // while the app was in the background.
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      const token = useAuthStore.getState().accessToken
      if (token && isTokenExpired(token)) {
        tryRefreshToken().catch(() => null)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [accessToken])

  if (checking) {
    // Minimum spinner prevents protected-content flash with expired tokens.
    return (
      <div className="flex h-screen items-center justify-center bg-[#0d141d]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Org requires 2FA and user has not configured it yet; allow only permitted routes.
  if (requiresOrgMfa && !ORG_MFA_ALLOWED.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/security" replace />
  }

  return <Outlet />
}
