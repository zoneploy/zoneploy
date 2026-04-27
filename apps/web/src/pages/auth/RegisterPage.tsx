import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { RegisterSchema, type RegisterInput } from '@zoneploy/types'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { useRegister } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { getApiError } from '@/lib/errors'

export function RegisterPage() {
  const { t } = useTranslation()
  const register_ = useRegister()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(RegisterSchema) })

  const onSubmit = (data: RegisterInput) => register_.mutate(data)

  return (
    <AuthLayout>
      <div className="flex flex-col gap-8">
        {/* Encabezado */}
        <div>
          <h1 className="font-heading text-2xl font-bold text-text-primary mb-1">
            {t('auth.signUpTitle')}
          </h1>
          <p className="text-sm text-text-secondary">
            {t('auth.signUpSubtitle')}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          {/* Formulario */}
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {/* Error global */}
            {!!register_.error && (
              <div className="rounded-md bg-error/10 border border-error/20 px-3 py-2 text-sm text-error">
                {getApiError(register_.error, t)}
              </div>
            )}

            {/* Nombre */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="fullName" className="text-sm font-medium text-text-primary">
                {t('auth.fullName')}
              </label>
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                {...register('fullName')}
                className={cn(
                  'h-10 w-full rounded-md border px-3 text-sm text-text-primary bg-background-paper',
                  'placeholder:text-text-disabled',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
                  'transition-colors',
                  errors.fullName ? 'border-error' : 'border-grey-100 hover:border-grey-300',
                )}
              />
              {errors.fullName && (
                <p className="text-xs text-error">{errors.fullName.message}</p>
              )}
            </div>

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
                  autoComplete="new-password"
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

            <button
              type="submit"
              disabled={register_.isPending}
              className="h-10 w-full rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {register_.isPending && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              {t('auth.createAccount')}
            </button>

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

        {/* Login */}
        <div>
          <p className="text-sm text-text-secondary">
            {t('auth.hasAccount')}{' '}
            <Link to="/login" className="text-primary hover:underline font-medium">
              {t('auth.login')}
            </Link>
            .
          </p>
        </div>
      </div>
    </AuthLayout>
  )
}
