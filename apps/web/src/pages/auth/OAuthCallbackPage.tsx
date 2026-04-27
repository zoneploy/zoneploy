import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { authApi, type OAuthProvider } from '@/api/auth'
import { getPostLoginPath } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/auth'
import { organizationsApi } from '@/api/organizations'
import { getApiError } from '@/lib/errors'
import { toSessionContext } from '@/lib/auth-session'

function isOAuthProvider(value: string | undefined): value is OAuthProvider {
  return value === 'google' || value === 'github'
}

function getStateStorageKey(provider: OAuthProvider) {
  return `zp_oauth_state_${provider}`
}

export function OAuthCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { provider: rawProvider } = useParams()
  const [searchParams] = useSearchParams()
  const setSession = useAuthStore(s => s.setSession)
  const setPendingMfa = useAuthStore(s => s.setPendingMfa)
  const [localError, setLocalError] = useState<string | null>(null)
  const startedRef = useRef(false)

  const exchange = useMutation({
    mutationFn: ({ provider, code }: { provider: OAuthProvider; code: string }) => authApi.oauthExchange(provider, code),
    onSuccess: async (data) => {
      if (isOAuthProvider(rawProvider)) {
        sessionStorage.removeItem(getStateStorageKey(rawProvider))
      }

      if ('requiresMfa' in data && data.requiresMfa) {
        setPendingMfa({
          type: data.mfaType,
          user: data.user,
        }, data.tempToken)
        navigate('/login', { replace: true })
        return
      }

      const successData = data as any
      setSession(successData.accessToken, toSessionContext(successData))
      queryClient.clear()
      await queryClient.prefetchQuery({
        queryKey: ['organizations'],
        queryFn: organizationsApi.list,
        staleTime: 5 * 60_000,
      })
      navigate(getPostLoginPath(successData), { replace: true })
    },
    onError: (error) => {
      if (isOAuthProvider(rawProvider)) {
        sessionStorage.removeItem(getStateStorageKey(rawProvider))
      }
      setLocalError(getApiError(error, t))
    },
  })

  useEffect(() => {
    if (startedRef.current) return

    if (!isOAuthProvider(rawProvider)) {
      setLocalError(t('auth.oauthProviderInvalid'))
      return
    }

    const state = searchParams.get('state')
    const code = searchParams.get('code')
    const providerError = searchParams.get('error')
    const storedState = sessionStorage.getItem(getStateStorageKey(rawProvider))

    if (providerError) {
      setLocalError(t('auth.oauthCancelled'))
      return
    }

    if (!code || !state) {
      setLocalError(t('auth.oauthCodeMissing'))
      return
    }

    if (!storedState || storedState !== state) {
      setLocalError(t('auth.oauthStateInvalid'))
      return
    }

    startedRef.current = true
    exchange.mutate({ provider: rawProvider, code })
  }, [exchange, rawProvider, searchParams, t])

  return (
    <AuthLayout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
            {t('auth.oauthCallbackTitle')}
          </h1>
          <p className="text-sm text-text-secondary">
            {localError ? t('auth.oauthFailedSubtitle') : t('auth.oauthCallbackSubtitle')}
          </p>
        </div>

        {localError ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-md bg-error/10 border border-error/20 px-3 py-3 text-sm text-error">
              {localError}
            </div>
            <Link
              to="/login"
              className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors flex items-center justify-center"
            >
              {t('auth.backToLogin')}
            </Link>
          </div>
        ) : (
          <div className="rounded-md border border-primary/15 bg-primary/5 px-4 py-6 text-sm text-text-secondary flex items-center gap-3">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
            <span>{t('auth.oauthFinishing')}</span>
          </div>
        )}
      </div>
    </AuthLayout>
  )
}
