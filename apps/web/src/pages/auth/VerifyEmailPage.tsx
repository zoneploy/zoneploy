import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { AuthLayout } from '@/components/layout/AuthLayout'

type State = 'verifying' | 'success' | 'error'

export function VerifyEmailPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)
  const [state, setState] = useState<State>('verifying')

  useEffect(() => {
    const token = searchParams.get('token')
    if (!token) {
      setState('error')
      return
    }

    authApi.verifyEmail(token)
      .then(() => {
        if (session) {
          setSession(session.accessToken, {
            ...session,
            user: { ...session.user, emailVerified: true },
          })
        }
        setState('success')
      })
      .catch(() => setState('error'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AuthLayout maxWidth="max-w-md">
      <div className="text-center space-y-6">
        {state === 'verifying' && (
          <>
            <Loader2 size={40} className="mx-auto text-primary animate-spin" />
            <p className="text-text-secondary">{t('emailVerification.verifying')}</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div className="mx-auto h-14 w-14 rounded-2xl bg-success/10 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-success" strokeWidth={1.6} />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-text-primary">
                {t('emailVerification.success')}
              </h1>
              <p className="text-sm text-text-secondary">
                {t('emailVerification.successSubtitle')}
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => navigate(session ? (session.org ? '/projects' : '/dashboard') : '/login?verified=1', { replace: true })}
            >
              {t('auth.continue')}
            </Button>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mx-auto h-14 w-14 rounded-2xl bg-error/10 flex items-center justify-center">
              <XCircle size={28} className="text-error" strokeWidth={1.6} />
            </div>
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-text-primary">
                {t('emailVerification.error')}
              </h1>
              <p className="text-sm text-text-secondary">
                {t('emailVerification.errorSubtitle')}
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => navigate('/', { replace: true })}>
              {t('common.back')}
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  )
}
