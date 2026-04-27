import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { organizationsApi } from '@/api/organizations'
import { useAuthStore } from '@/stores/auth'
import { getApiError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SessionContext, OrgRole } from '@zoneploy/types'

export function CreateOrgPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const session = useAuthStore(s => s.session)
  const setSession = useAuthStore(s => s.setSession)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  if (session?.org) {
    return <Navigate to="/projects" replace />
  }

  const create = useMutation({
    mutationFn: () => organizationsApi.create({ name: name.trim() }),
    onSuccess: data => {
      if (!session) return
      const updated: SessionContext = {
        ...session,
        org: {
          id: data.id,
          name: data.name,
          slug: data.slug,
          logoUrl: data.logoUrl ?? null,
          require2fa: false,
          role: data.role as OrgRole,
          customRoleId: null,
          permissions: data.permissions ?? [],
        },
      }
      setSession(session.accessToken, updated)
      queryClient.clear()
      navigate('/projects', { replace: true })
    },
    onError: (err: unknown) => setError(getApiError(err, t)),
  })

  return (
    <div className="w-full">
      <div className="bg-background-paper rounded-4xl shadow-darker-xs p-8 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 size={22} className="text-primary" strokeWidth={1.6} />
          </div>
          <h1 className="text-xl font-bold text-text-primary">{t('organization.createTitle')}</h1>
          <p className="text-sm text-text-secondary">{t('organization.createSubtitle')}</p>
        </div>

        {error && (
          <div className="rounded-xl bg-error/10 border border-error/20 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ws-name">{t('onboarding.orgName')}</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder={t('onboarding.orgNamePlaceholder')}
            onKeyDown={e => e.key === 'Enter' && name.trim().length >= 2 && create.mutate()}
            autoFocus
          />
          <p className="text-xs text-text-secondary">{t('onboarding.orgNameHint')}</p>
        </div>

        <Button
          className="w-full"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={name.trim().length < 2}
        >
          {t('onboarding.createButton')}
          <ArrowRight size={14} className="ml-auto" />
        </Button>
      </div>
    </div>
  )
}
