import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { startAuthentication } from '@simplewebauthn/browser'
import { LoginSchema, type LoginInput } from '@zoneploy/types'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { SocialAuthButtons } from '@/components/shared/SocialAuthButtons'
import { getPostLoginPath, useLogin } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/auth'
import { apiClient, ApiError } from '@/lib/api-client'
import { toSessionContext } from '@/lib/auth-session'
import { OtpInput } from '@/components/ui/OtpInput'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getApiError } from '@/lib/errors'
import { authApi } from '@/api/auth'

// Helper to translate WebAuthn errors.
function translateWebAuthnError(error: any, t: any): string {
  if (!error) return t('auth.webauthnError')

  const message = error?.message?.toLowerCase() ?? ''

  if (error.name === 'NotAllowedError' || message.includes('user denied')) {
    return t('auth.webauthnNotAllowed')
  }
  if (message.includes('timeout')) {
    return t('auth.webauthnTimeout')
  }
  if (message.includes('invalid') || message.includes('state')) {
    return t('auth.webauthnInvalidState')
  }
  if (message.includes('not supported') || message.includes('unsupported')) {
    return t('auth.webauthnNotSupported')
  }

  return error.message || t('auth.webauthnError')
}

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const login = useLogin()
  const pendingMfa = useAuthStore(s => s.pendingMfa)
  const setSession = useAuthStore(s => s.setSession)
  const clearSession = useAuthStore(s => s.clearSession)
  const [showPassword, setShowPassword] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; msg: string } | null>(null)
  const [lastSubmittedEmail, setLastSubmittedEmail] = useState(searchParams.get('email') ?? '')
  const [resendFeedback, setResendFeedback] = useState<string | null>(null)
  const prefilledEmail = searchParams.get('email') ?? ''
  const showVerificationPending = searchParams.get('verification') === 'pending' && !!prefilledEmail
  const showVerified = searchParams.get('verified') === '1'
  const blockedEmail = login.error instanceof ApiError && login.error.code === 'EMAIL_NOT_VERIFIED'
    ? lastSubmittedEmail || prefilledEmail
    : ''

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: prefilledEmail, password: '' },
  })

  const onSubmit = (data: LoginInput) => {
    setLastSubmittedEmail(data.email)
    setResendFeedback(null)
    login.mutate(data)
  }

  const resendVerification = useMutation({
    mutationFn: (email: string) => authApi.resendVerification(email, i18n.language?.startsWith('en') ? 'en' : 'es'),
    onSuccess: () => {
      setResendFeedback(t('emailVerification.resentTo', { email: blockedEmail || prefilledEmail }))
    },
    onError: (error: unknown) => {
      setResendFeedback(getApiError(error, t))
    },
  })

  // Verificar WebAuthn MFA
  const verifyWebAuthnMfa = useMutation({
    mutationFn: async () => {
      const options = await apiClient.post<Record<string, unknown>>('/auth/mfa/webauthn/options')
      const response = await startAuthentication({ optionsJSON: options as any })
      return apiClient.post<any>('/auth/mfa/webauthn/verify', { response })
    },
    onSuccess: data => {
      setSession(data.accessToken, toSessionContext(data))
      navigate(getPostLoginPath(data))
    },
    onError: (error: any) => {
      const translatedError = translateWebAuthnError(error, t)
      setFeedback({ type: 'error', msg: translatedError })
    },
  })

  // Verificar TOTP MFA
  const verifyTotpMfa = useMutation({
    mutationFn: () =>
      apiClient.post<any>('/auth/mfa/totp/verify', { code: totpCode }),
    onSuccess: data => {
      setSession(data.accessToken, toSessionContext(data))
      navigate(getPostLoginPath(data))
    },
    onError: (error: any) => {
      setFeedback({ type: 'error', msg: getApiError(error, t) })
    },
  })

  // Pantalla MFA
  if (pendingMfa) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-8">
          <div>
            <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
              {t('auth.mfaTitle')}
            </h1>
            <p className="text-sm text-text-secondary">
              {pendingMfa.type === 'webauthn'
                ? t('auth.mfaTouchKey')
                : t('auth.mfaEnterCode')}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {pendingMfa.type === 'webauthn' && (
              <>
                <Button
                  onClick={() => {
                    setFeedback(null)
                    verifyWebAuthnMfa.mutate()
                  }}
                  loading={verifyWebAuthnMfa.isPending}
                  className="w-full h-10"
                >
                  {t('auth.mfaTouchKeyButton')}
                </Button>
                {feedback && feedback.type === 'error' && (
                  <div className="rounded-md bg-error/10 border border-error/20 px-3 py-2 text-sm text-error">
                    {feedback.msg}
                  </div>
                )}
              </>
            )}

            {pendingMfa.type === 'totp' && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-primary">{t('auth.verificationCode')}</label>
                  <OtpInput value={totpCode} onChange={setTotpCode} />
                </div>
                <Button
                  onClick={() => {
                    setFeedback(null)
                    verifyTotpMfa.mutate()
                  }}
                  loading={verifyTotpMfa.isPending}
                  disabled={totpCode.length !== 6}
                  className="w-full h-10"
                >
                  {t('auth.mfaTotpVerify')}
                </Button>
                {feedback && feedback.type === 'error' && (
                  <div className="rounded-md bg-error/10 border border-error/20 px-3 py-2 text-sm text-error">
                    {feedback.msg}
                  </div>
                )}
              </>
            )}

            <button
              onClick={() => {
                clearSession()
                setTotpCode('')
              }}
              className="text-center text-sm text-text-secondary hover:text-primary transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-8">
        {/* Encabezado */}
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
            {t('auth.signInTitle')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('auth.signInSubtitle')}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <SocialAuthButtons />

          {/* Formulario */}
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {showVerificationPending && !blockedEmail && (
              <div className="rounded-md border border-primary/15 bg-primary/5 px-3 py-3 text-sm">
                <p className="font-medium text-text-primary">{t('emailVerification.pendingTitle')}</p>
                <p className="mt-1 text-text-secondary">
                  {t('emailVerification.pendingSubtitle', { email: prefilledEmail })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={resendVerification.isPending}
                    onClick={() => resendVerification.mutate(prefilledEmail)}
                  >
                    {t('emailVerification.resend')}
                  </Button>
                  {resendFeedback && (
                    <span className="text-xs text-text-secondary">{resendFeedback}</span>
                  )}
                </div>
              </div>
            )}

            {showVerified && !blockedEmail && (
              <div className="rounded-md border border-success/15 bg-success/5 px-3 py-3 text-sm">
                <p className="font-medium text-text-primary">{t('emailVerification.success')}</p>
                <p className="mt-1 text-text-secondary">{t('emailVerification.loginReady')}</p>
              </div>
            )}

            {/* Error global */}
            {login.error && (
              blockedEmail ? (
                <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-3 text-sm">
                  <p className="font-medium text-text-primary">{t('errors.emailNotVerified')}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      loading={resendVerification.isPending}
                      onClick={() => resendVerification.mutate(blockedEmail)}
                    >
                      {t('emailVerification.resend')}
                    </Button>
                    {resendFeedback && (
                      <span className="text-xs text-text-secondary">{resendFeedback}</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-md bg-error/10 border border-error/20 px-3 py-2 text-sm text-error">
                  {login.error instanceof TypeError
                    ? t('auth.networkError')
                    : getApiError(login.error, t)}
                </div>
              )
            )}

            {feedback && feedback.type === 'error' && (
              <div className="rounded-md bg-error/10 border border-error/20 px-3 py-2 text-sm text-error">
                {feedback.msg}
              </div>
            )}

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-medium text-text-primary">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className={cn(
                  'h-10 w-full rounded-md border px-3 text-sm text-text-primary bg-background-paper',
                  'placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
                  'transition-colors',
                  errors.email ? 'border-error' : 'border-grey-100 hover:border-grey-300',
                )}
              />
              {errors.email && (
                <p className="text-xs text-error">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-medium text-text-primary">
                {t('auth.password')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  {...register('password')}
                  className={cn(
                    'h-10 w-full rounded-md border px-3 pr-10 text-sm text-text-primary bg-background-paper',
                    'placeholder:text-text-disabled',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
                    'transition-colors',
                    errors.password ? 'border-error' : 'border-grey-100 hover:border-grey-300',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-error">{errors.password.message}</p>
              )}
            </div>

            {/* Acciones */}
            <div className="flex flex-col gap-2">
              <Link
                to="/forgot-password"
                className="text-center text-sm font-semibold text-text-secondary hover:text-primary transition-colors"
              >
                {t('auth.forgotPassword')}
              </Link>
              <button
                type="submit"
                disabled={login.isPending}
                className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {login.isPending && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {t('auth.continue')}
              </button>
            </div>

            {/* Legal */}
            <p className="text-xs text-text-secondary leading-relaxed">
              {t('auth.legalPrefix')}{' '}
              <Link to="/terms" className="text-primary hover:underline">
                {t('auth.terms')}
              </Link>{' '}
              {t('auth.legalAnd')}{' '}
              <Link to="/privacy" className="text-primary hover:underline">
                {t('auth.privacy')}
              </Link>
              .
            </p>
          </form>
        </div>

        {/* Divisor inferior */}
        <div className="h-px bg-grey-100" />

        {/* Registro */}
        <div className="">
          <h2 className="text-sm font-semibold text-text-primary mb-1">
            {t('auth.getStartedTitle')}
          </h2>
          <p className="text-sm text-text-secondary">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-primary hover:underline font-medium">
              {t('auth.register')}
            </Link>
            .
          </p>
        </div>
      </div>
    </AuthLayout>
  )
}
