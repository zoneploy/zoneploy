import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, XCircle, Loader2, ArrowRight, Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { invitationsApi } from '@/api/members'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleBadge } from '@/components/shared/RoleBadge'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { Logo } from '@/components/Logo'
import { RegisterSchema, type RegisterInput, type OrgRole } from '@zoneploy/types'
import type { SessionContext, AuthResponse, RegisterResponse } from '@zoneploy/types'
import { getApiError } from '@/lib/errors'

type AuthMode = 'choose' | 'register' | 'login'

// Invitation info card

function InvitationInfoCard({ orgName, invitedByName, role, customRoleName }: {
  orgName: string
  invitedByName: string
  role: string
  customRoleName?: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-primary/5 border border-primary/15 px-5 py-4 mb-6">
      <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Building2 size={20} className="text-primary" strokeWidth={1.6} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-secondary">
          <span className="font-semibold text-text-primary">{invitedByName}</span>{' '}
          {t('invitation.invitedBy')}
        </p>
        <p className="text-base font-semibold text-text-primary truncate">{orgName}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-xs text-text-secondary">{t('invitation.role')}</span>
          <RoleBadge role={role as OrgRole} label={role === 'custom' ? customRoleName : undefined} />
        </div>
      </div>
    </div>
  )
}

// Inline error

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-xl bg-red-500/8 border border-red-500/20 px-4 py-3 text-sm text-red-400">
      {message}
    </div>
  )
}

// Main page

export function AcceptInvitationPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated())
  const [mode, setMode] = useState<AuthMode>('choose')
  const [accepted, setAccepted] = useState(false)

  const { data: invitation, isLoading, error } = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => invitationsApi.get(token!),
    enabled: !!token,
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => invitationsApi.accept(token!),
    onSuccess: (result) => {
      // Update the session with the newly accepted org.
      if (session) {
        setSession(session.accessToken, {
          ...session,
          org: {
            id: result.orgId,
            name: result.orgName,
            slug: result.orgSlug,
            logoUrl: null,
            role: result.role as OrgRole,
            customRoleId: result.customRoleId,
            permissions: result.permissions,
            require2fa: false,
          },
        })
      }
      setAccepted(true)
      setTimeout(() => navigate('/projects'), 2000)
    },
  })

  // Estado de carga
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    )
  }

  // Invalid or expired invitation; both cases use AuthLayout.
  if (error || !invitation) {
    return (
      <AuthLayout maxWidth="max-w-md">
        <div className="text-center space-y-3">
          <div className="mx-auto h-14 w-14 rounded-full bg-red-500/10 flex items-center justify-center">
            <XCircle size={28} className="text-red-400" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">{t('invitation.invalid')}</h2>
          <p className="text-text-secondary text-sm">{t('invitation.invalidSubtitle')}</p>
          <Link to="/login" className="inline-block text-sm text-primary hover:underline mt-2">
            {t('invitation.goHome')}
          </Link>
        </div>
      </AuthLayout>
    )
  }

  // Accepted successfully; both cases.
  if (accepted) {
    const content = (
      <div className="text-center space-y-3">
        <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle2 size={28} className="text-emerald-500" />
        </div>
        <h2 className="text-lg font-semibold text-text-primary">
          {t('invitation.welcome', { organization: invitation.orgName })}
        </h2>
        <p className="text-text-secondary text-sm">{t('invitation.redirecting')}</p>
      </div>
    )

    if (isAuthenticated) return <AppInviteShell>{content}</AppInviteShell>
    return <AuthLayout maxWidth="max-w-md">{content}</AuthLayout>
  }

  // Authenticated user
  if (isAuthenticated && session) {
    return (
      <AppInviteShell>
        <InvitationInfoCard
          orgName={invitation.orgName}
          invitedByName={invitation.invitedByName}
          role={invitation.role}
          customRoleName={invitation.customRoleName}
        />

        <p className="text-sm text-text-secondary mb-4">
          {t('invitation.loggedAs')}{' '}
          <span className="font-semibold text-text-primary">{session.user.email}</span>
        </p>

        {accept.error && <InlineError message={(accept.error as Error).message} />}

        <Button
          className="w-full"
          onClick={() => accept.mutate()}
          loading={accept.isPending}
        >
          {t('invitation.accept')}
          <ArrowRight size={15} />
        </Button>
      </AppInviteShell>
    )
  }

  // Unauthenticated user: use AuthLayout.
  return (
    <AuthLayout maxWidth="max-w-md">
      <InvitationInfoCard
        orgName={invitation.orgName}
        invitedByName={invitation.invitedByName}
        role={invitation.role}
        customRoleName={invitation.customRoleName}
      />

      {mode === 'choose' && (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary text-center mb-1">
            {t('invitation.howToContinue')}
          </p>
          <Button className="w-full" onClick={() => setMode('register')}>
            {t('invitation.createAccount')}
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => setMode('login')}>
            {t('invitation.haveAccount')}
          </Button>
        </div>
      )}

      {mode === 'register' && (
        <RegisterAndAccept
          invitation={invitation}
          onBack={() => setMode('choose')}
          onGoToLogin={() => setMode('login')}
        />
      )}

      {mode === 'login' && (
        <LoginAndAccept
          token={token!}
          onBack={() => setMode('choose')}
          onSuccess={setAccepted}
          setSession={setSession}
        />
      )}
    </AuthLayout>
  )
}

// Authenticated user shell with dashboard style

function AppInviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Minimal topbar. */}
      <header className="h-20 bg-background-paper shadow-darker-xs rounded-b-3xl px-6 flex items-center">
        <Logo />
      </header>
      {/* Centered content. */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md bg-background-paper rounded-4xl shadow-darker-xs py-10 px-8">
          {children}
        </div>
      </div>
    </div>
  )
}

// Register and accept

function RegisterAndAccept({
  invitation, onBack, onGoToLogin,
}: {
  invitation: { email: string }
  onBack: () => void
  onGoToLogin: () => void
}) {
  const { t, i18n } = useTranslation()
  const { register, handleSubmit, formState: { errors } } = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { email: invitation.email },
  })
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')

  const onSubmit = async (data: RegisterInput) => {
    setLoading(true)
    setServerError('')
    try {
      const lang = i18n.language?.startsWith('en') ? 'en' : 'es'
      const result = await authApi.register({ ...data, lang }) as RegisterResponse
      setRegisteredEmail(result.email)
    } catch (e) {
      setServerError(getApiError(e, t))
    } finally {
      setLoading(false)
    }
  }

  if (registeredEmail) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm text-text-secondary hover:text-primary flex items-center gap-1">
          ← {t('common.back')}
        </button>
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-4 py-4">
          <h3 className="text-base font-semibold text-text-primary">{t('invitation.verifyEmailTitle')}</h3>
          <p className="mt-1 text-sm text-text-secondary">
            {t('invitation.verifyEmailSubtitle', { email: registeredEmail })}
          </p>
        </div>
        <Button type="button" variant="secondary" className="w-full" onClick={onGoToLogin}>
          {t('auth.login')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-text-secondary hover:text-primary flex items-center gap-1">
        ← {t('common.back')}
      </button>
      <h3 className="text-base font-semibold text-text-primary">{t('auth.signUpTitle')}</h3>
      {serverError && <InlineError message={serverError} />}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t('invitation.fullName')}</Label>
          <Input placeholder={t('invitation.fullNamePlaceholder')} {...register('fullName')} />
          {errors.fullName && <p className="text-xs text-red-400">{errors.fullName.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label>{t('auth.email')}</Label>
          <Input type="email" {...register('email')} disabled />
        </div>
        <div className="space-y-1.5">
          <Label>{t('auth.password')}</Label>
          <Input type="password" placeholder={t('invitation.passwordPlaceholder')} {...register('password')} />
          {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          {t('invitation.createAndAccept')}
        </Button>
      </form>
    </div>
  )
}

// Login + aceptar

function LoginAndAccept({
  token, onBack, onSuccess, setSession,
}: {
  token: string
  onBack: () => void
  onSuccess: (v: boolean) => void
  setSession: (token: string, s: SessionContext) => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setServerError('')
    try {
      const auth = await authApi.login({ email, password }) as AuthResponse
      if ('requiresMfa' in auth && auth.requiresMfa) {
        setServerError(t('invitation.mfaRequired'))
        return
      }
      const result = await invitationsApi.accept(token)
      setSession(auth.accessToken, {
        accessToken: auth.accessToken,
        user: { ...auth.user, isPlatformAdmin: false, totpEnabled: false },
        org: {
          id: result.orgId,
          name: result.orgName,
          slug: result.orgSlug,
          logoUrl: null,
          role: result.role as OrgRole,
          customRoleId: result.customRoleId,
          permissions: result.permissions,
          require2fa: false,
        },
      })
      onSuccess(true)
    } catch (e) {
      setServerError(getApiError(e, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-text-secondary hover:text-primary flex items-center gap-1">
        ← {t('common.back')}
      </button>
      <h3 className="text-base font-semibold text-text-primary">{t('auth.signInTitle')}</h3>
      {serverError && <InlineError message={serverError} />}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t('auth.email')}</Label>
          <Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="space-y-1.5">
          <Label>{t('auth.password')}</Label>
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          {t('invitation.loginAndAccept')}
        </Button>
      </form>
    </div>
  )
}
