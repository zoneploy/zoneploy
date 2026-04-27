import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { OtpInput } from '@/components/ui/OtpInput'
import { apiClient } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { getApiError } from '@/lib/errors'

// Flow steps
type Step = 'email' | 'code' | 'password' | 'done'

// Error inline
function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="text-xs text-error mt-1">{msg}</p>
}

function ServerError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div className="rounded-xl bg-red-500/8 border border-red-500/20 px-4 py-3 text-sm text-red-400">
      {msg}
    </div>
  )
}

// Shared input.
function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-10 w-full rounded-md border px-3 text-sm text-text-primary bg-background-paper',
        'placeholder:text-text-disabled',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors',
        'border-grey-100 hover:border-grey-300',
        props.className,
      )}
    />
  )
}

// Step 1: enter email
function StepEmail({ onNext }: { onNext: (email: string) => void }) {
  const { t, i18n } = useTranslation()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading(true)
    setError('')
    try {
      const lang = i18n.language?.startsWith('en') ? 'en' : 'es'
      await apiClient.post('/auth/reset-password/request', { email, lang })
      onNext(email)
    } catch (err) {
      setError(getApiError(err, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
          {t('auth.resetTitle')}
        </h1>
        <p className="text-sm text-text-secondary">{t('auth.resetSubtitle')}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-primary">{t('auth.email')}</label>
          <AuthInput
            type="email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="tu@email.com"
          />
        </div>

        <ServerError msg={error} />

        <button
          type="submit"
          disabled={loading || !email}
          className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {loading ? '...' : t('auth.sendResetCode')}
        </button>
      </form>

      <Link to="/login" className="flex items-center gap-2 text-sm text-text-secondary hover:text-primary transition-colors">
        <ArrowLeft size={14} />
        {t('auth.backToLogin')}
      </Link>
    </div>
  )
}

// Step 2: enter 6-digit code
function StepCode({ email, onNext, onBack }: { email: string; onNext: (code: string) => void; onBack: () => void }) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.length !== 6) return
    setLoading(true)
    setError('')
    try {
      await apiClient.post('/auth/reset-password/verify', { email, code })
      onNext(code)
    } catch (err) {
      setError(getApiError(err, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
          {t('auth.resetCodeTitle')}
        </h1>
        <p className="text-sm text-text-secondary">
          {t('auth.resetCodeSubtitle', { email })}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium text-text-primary">{t('auth.verificationCode')}</label>
          <OtpInput value={code} onChange={setCode} />
        </div>

        <ServerError msg={error} />

        <button
          type="submit"
          disabled={loading || code.length !== 6}
          className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {loading ? '...' : t('auth.continue')}
        </button>
      </form>

      <div className="space-y-2">
        <div className="h-px bg-grey-100" />
        <p className="text-sm font-semibold text-text-primary">{t('auth.noCode')}</p>
        <p className="text-sm text-text-secondary">
          {t('auth.noCodeHint')}{' '}
          <button onClick={onBack} className="text-primary hover:underline font-medium">
            {t('auth.resendCode')}
          </button>
        </p>
      </div>
    </div>
  )
}

// Step 3: new password
function StepPassword({ email, code, onDone }: { email: string; code: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const mismatch = confirm && password !== confirm

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm || password.length < 8) return
    setLoading(true)
    setError('')
    try {
      await apiClient.post('/auth/reset-password/confirm', { email, code, newPassword: password })
      onDone()
    } catch (err) {
      setError(getApiError(err, t))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
          {t('auth.newPasswordTitle')}
        </h1>
        <p className="text-sm text-text-secondary">{t('auth.newPasswordSubtitle')}</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-primary">{t('auth.password')}</label>
          <div className="relative">
            <AuthInput
              type={show ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={t('invitation.passwordPlaceholder')}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
            >
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {password && password.length < 8 && (
            <FieldError msg={t('profile.passwordTooShort')} />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text-primary">{t('profile.confirmPassword')}</label>
          <AuthInput
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className={mismatch ? 'border-error' : ''}
          />
          {mismatch && <FieldError msg={t('profile.passwordMismatch')} />}
        </div>

        <ServerError msg={error} />

        <button
          type="submit"
          disabled={loading || password.length < 8 || password !== confirm}
          className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {loading ? '...' : t('auth.setNewPassword')}
        </button>
      </form>
    </div>
  )
}

// Step 4: success
function StepDone() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6 text-center">
      <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
        <CheckCircle2 size={32} className="text-emerald-500" />
      </div>
      <div>
        <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
          {t('auth.resetDoneTitle')}
        </h1>
        <p className="text-sm text-text-secondary">{t('auth.resetDoneSubtitle')}</p>
      </div>
      <Link
        to="/login"
        className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark transition-colors flex items-center justify-center"
      >
        {t('auth.login')}
      </Link>
    </div>
  )
}

// Main page
export function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')

  return (
    <AuthLayout>
      {step === 'email' && (
        <StepEmail onNext={e => { setEmail(e); setStep('code') }} />
      )}
      {step === 'code' && (
        <StepCode
          email={email}
          onNext={c => { setCode(c); setStep('password') }}
          onBack={() => setStep('email')}
        />
      )}
      {step === 'password' && (
        <StepPassword email={email} code={code} onDone={() => setStep('done')} />
      )}
      {step === 'done' && <StepDone />}
    </AuthLayout>
  )
}
