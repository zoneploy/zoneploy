import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Upload, Trash2 } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { organizationsApi, type OrgDetail } from '@/api/organizations'
import { cn } from '@/lib/utils'
import { OrgLogo } from '@/components/organization/OrgLogo'

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        checked ? 'bg-primary' : 'bg-grey-200',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className={cn(
        'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0',
      )} />
    </button>
  )
}

function LogoSection({ orgId, logoUrl, orgName, canEdit }: {
  orgId: string
  logoUrl: string | null
  orgName: string
  canEdit: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const { session, accessToken, setSession } = useAuthStore()

  const updateSessionLogo = (newLogoUrl: string | null) => {
    if (session && accessToken) {
      setSession(accessToken, {
        ...session,
        org: session.org ? { ...session.org, logoUrl: newLogoUrl } : null,
      })
    }
  }

  const upload = useMutation({
    mutationFn: (file: File) => organizationsApi.uploadLogo(orgId, file),
    onSuccess: (data) => {
      queryClient.setQueryData<OrgDetail>(['org', orgId], old =>
        old ? { ...old, logoUrl: data.logoUrl } : old,
      )
      updateSessionLogo(data.logoUrl)
      setPreview(null)
    },
  })

  const deleteLogo = useMutation({
    mutationFn: () => organizationsApi.deleteLogo(orgId),
    onSuccess: () => {
      queryClient.setQueryData<OrgDetail>(['org', orgId], old =>
        old ? { ...old, logoUrl: null } : old,
      )
      updateSessionLogo(null)
      setPreview(null)
    },
  })

  const [logoError, setLogoError] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError(null)
    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
    if (!isPng) {
      setLogoError(t('organization.logoInvalidType'))
      e.target.value = ''
      return
    }
    if (file.size > 512 * 1024) {
      setLogoError(t('organization.logoTooLarge'))
      e.target.value = ''
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setPreview(objectUrl)
    upload.mutate(file)
    e.target.value = ''
  }

  const currentImage = preview ?? logoUrl

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organization.logo')}</CardTitle>
        <CardDescription>{t('organization.logoHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-5">
          <div className="h-20 w-20 rounded-2xl overflow-hidden bg-primary/10 flex items-center justify-center shrink-0 border border-grey-100">
            <OrgLogo
              src={currentImage}
              alt={orgName}
              className="h-full w-full p-1"
              fallbackClassName="p-4"
            />
          </div>

          {canEdit && (
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                loading={upload.isPending}
              >
                <Upload size={13} />
                {currentImage ? t('organization.changeLogo') : t('organization.uploadLogo')}
              </Button>

              {(logoUrl || preview) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => deleteLogo.mutate()}
                  loading={deleteLogo.isPending}
                  className="text-destructive hover:text-destructive hover:bg-destructive/5"
                >
                  <Trash2 size={13} />
                  {t('organization.deleteLogo')}
                </Button>
              )}

              <p className="text-xs text-text-secondary">{t('organization.logoHintPng')}</p>

              {(upload.isSuccess || deleteLogo.isSuccess) && (
                <p className="text-xs text-success">
                  {upload.isSuccess ? t('organization.logoUploaded') : t('organization.logoDeleted')}
                </p>
              )}
              {(upload.isError || logoError) && (
                <p className="text-xs text-destructive">
                  {logoError ?? (upload.error as Error).message}
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function OrgSettingsPage() {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const queryClient = useQueryClient()

  const { data: org } = useQuery({
    queryKey: ['org', orgId],
    queryFn: () => organizationsApi.get(orgId),
    enabled: !!orgId,
  })

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<{ name: string }>()

  useEffect(() => {
    if (org) reset({ name: org.name })
  }, [org, reset])

  const update = useMutation({
    mutationFn: (data: { name: string }) => organizationsApi.update(orgId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['org', orgId] }) },
  })

  const toggle2fa = useMutation({
    mutationFn: (require2fa: boolean) => organizationsApi.update(orgId, { require2fa }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['org', orgId] }) },
  })

  if (!session?.org) return <Navigate to="/dashboard" replace />

  const { can } = usePermissions()
  const canEdit = can('organization:manage')

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('organization.settingsTitle')}
        subtitle={t('organization.settingsSubtitlePage')}
      />

      <LogoSection
        orgId={orgId}
        logoUrl={org?.logoUrl ?? null}
        orgName={org?.name ?? session.org.name}
        canEdit={canEdit}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('organization.settings')}</CardTitle>
          <CardDescription>{t('organization.settingsSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {update.isSuccess && (
            <div className="mb-4 rounded-md bg-success/10 border border-success/20 px-3 py-2 text-sm text-success">
              {t('organization.savedOk')}
            </div>
          )}
          <form onSubmit={handleSubmit(d => update.mutate(d))} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">{t('organization.orgName')}</Label>
              <Input id="name" disabled={!canEdit} error={errors.name?.message} {...register('name')} />
              {errors.name && <p className="text-xs text-error">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t('organization.slug')}</Label>
              <Input value={org?.slug ?? ''} disabled />
              <p className="text-xs text-text-secondary">{t('organization.slugHint')}</p>
            </div>
            {canEdit && (
              <Button type="submit" disabled={!isDirty} loading={update.isPending}>
                {t('common.saveChanges')}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-text-primary">{t('organization.require2fa')}</p>
              <p className="text-xs text-text-secondary max-w-sm leading-relaxed">
                {t('organization.require2faHint')}
              </p>
              {toggle2fa.isSuccess && (
                <p className="text-xs text-success">{t('organization.require2faSaved')}</p>
              )}
            </div>
            <Toggle
              checked={org?.require2fa ?? false}
              onChange={v => toggle2fa.mutate(v)}
              disabled={!canEdit || toggle2fa.isPending}
            />
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
