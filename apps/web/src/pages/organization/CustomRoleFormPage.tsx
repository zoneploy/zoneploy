import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Save, Shield } from 'lucide-react'
import type { Permission } from '@zoneploy/types'
import { customRolesApi, type CustomRole } from '@/api/customRoles'
import { organizationsApi } from '@/api/organizations'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { cn } from '@/lib/utils'

const PERMISSION_GROUPS: Record<string, Permission[]> = {
  projects: ['projects:read', 'projects:create', 'projects:update', 'projects:delete'],
  environments: ['environments:read', 'environments:create', 'environments:update', 'environments:delete', 'environments:deploy'],
  containers: ['containers:read', 'containers:write', 'containers:deploy', 'containers:terminal'],
  stacks: ['stacks:read', 'stacks:write', 'stacks:deploy', 'stacks:terminal'],
  servers: ['servers:read', 'servers:connect', 'servers:terminal'],
  members: ['members:read', 'members:invite', 'members:manage'],
  organization: ['organization:manage'],
  secrets: ['secrets:read', 'secrets:write'],
  audit: ['audit:read'],
}

interface RoleFormValues {
  name: string
  description: string
  permissions: Permission[]
}

function normalizeRoleForm(role?: CustomRole): RoleFormValues {
  return {
    name: role?.name ?? '',
    description: role?.description ?? '',
    permissions: role?.permissions ?? [],
  }
}

export function CustomRoleFormPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { roleId } = useParams()
  const queryClient = useQueryClient()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const isEditing = !!roleId
  const { can } = usePermissions()
  const canManage = can('members:manage')

  const orgQuery = useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => organizationsApi.get(orgId),
    enabled: !!orgId,
  })
  const isFreePlan = orgQuery.data?.subscription?.planSlug === 'free'
  const planKnown = !!orgQuery.data?.subscription

  const roleQuery = useQuery({
    queryKey: ['custom-roles', orgId, roleId],
    queryFn: () => customRolesApi.get(orgId, roleId!),
    enabled: !!orgId && isEditing && canManage && planKnown && !isFreePlan,
  })

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<RoleFormValues>({
    defaultValues: normalizeRoleForm(),
  })

  useEffect(() => {
    if (roleQuery.data) reset(normalizeRoleForm(roleQuery.data))
  }, [roleQuery.data, reset])

  const selectedPerms = watch('permissions')

  const togglePermission = (permission: Permission) => {
    const next = selectedPerms.includes(permission)
      ? selectedPerms.filter(item => item !== permission)
      : [...selectedPerms, permission]

    setValue('permissions', next, { shouldDirty: true, shouldValidate: true })
  }

  const toggleGroup = (permissions: Permission[]) => {
    const allSelected = permissions.every(permission => selectedPerms.includes(permission))
    const next = allSelected
      ? selectedPerms.filter(permission => !permissions.includes(permission))
      : [...new Set([...selectedPerms, ...permissions])]

    setValue('permissions', next, { shouldDirty: true, shouldValidate: true })
  }

  const create = useMutation({
    mutationFn: (data: RoleFormValues) => customRolesApi.create(orgId, {
      name: data.name.trim(),
      description: data.description.trim() || undefined,
      permissions: data.permissions,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['custom-roles', orgId] })
      navigate('/custom-roles')
    },
  })

  const update = useMutation({
    mutationFn: (data: RoleFormValues) => customRolesApi.update(orgId, roleId!, {
      name: data.name.trim(),
      description: data.description.trim() || undefined,
      permissions: data.permissions,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['custom-roles', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['custom-roles', orgId, roleId] }),
      ])
      navigate('/custom-roles')
    },
  })

  const mutation = isEditing ? update : create

  const onSubmit = (data: RoleFormValues) => {
    if (data.permissions.length === 0) return
    mutation.mutate(data)
  }

  if (!canManage) {
    return (
      <EmptyState
        icon={Shield}
        title={t('customRoles.forbiddenTitle')}
        subtitle={t('customRoles.forbiddenSubtitle')}
      />
    )
  }

  if (orgQuery.isLoading) {
    return <LoadingState />
  }

  if (isFreePlan) {
    return (
      <EmptyState
        icon={Shield}
        title={t('customRoles.paidPlanOnlyTitle')}
        subtitle={t('customRoles.paidPlanOnlySubtitle')}
        action={{ label: t('customRoles.backToRoles'), onClick: () => navigate('/custom-roles'), icon: <ArrowLeft size={13} /> }}
      />
    )
  }

  if (isEditing && roleQuery.isLoading) {
    return <LoadingState />
  }

  if (isEditing && !roleQuery.data) {
    return (
      <EmptyState
        icon={Shield}
        title={t('customRoles.notFoundTitle')}
        subtitle={t('customRoles.notFoundSubtitle')}
        action={{ label: t('customRoles.backToRoles'), onClick: () => navigate('/custom-roles'), icon: <ArrowLeft size={13} /> }}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="w-full space-y-6">
      <PageHeader
        title={isEditing ? t('customRoles.editTitle') : t('customRoles.createTitle')}
        subtitle={isEditing ? t('customRoles.editSubtitle') : t('customRoles.createSubtitle')}
        action={(
          <Button type="button" variant="secondary" onClick={() => navigate('/custom-roles')}>
            <ArrowLeft size={14} />{t('customRoles.backToRoles')}
          </Button>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('customRoles.details')}</CardTitle>
              <CardDescription>{t('customRoles.detailsSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">{t('customRoles.name')}</Label>
                <Input
                  id="role-name"
                  placeholder={t('customRoles.namePlaceholder')}
                  {...register('name', { required: true, minLength: 2, maxLength: 60 })}
                />
                {errors.name && <p className="text-xs text-destructive">{t('customRoles.nameError')}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="role-description">{t('customRoles.description')}</Label>
                <Input
                  id="role-description"
                  placeholder={t('customRoles.descriptionPlaceholder')}
                  {...register('description', { maxLength: 300 })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('customRoles.permissions')}</CardTitle>
              <CardDescription>{t('customRoles.permissionsSubtitle')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => {
                const allSelected = permissions.every(permission => selectedPerms.includes(permission))
                const someSelected = permissions.some(permission => selectedPerms.includes(permission))

                return (
                  <div key={group} className="overflow-hidden rounded-lg border border-border bg-background-paper">
                    <button
                      type="button"
                      onClick={() => toggleGroup(permissions)}
                      className="flex w-full items-center justify-between gap-3 border-b border-border bg-grey-50/50 px-4 py-3 text-left transition-colors hover:bg-grey-50"
                    >
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-primary">
                          {t(`customRoles.permGroups.${group}`)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-secondary">
                          {t('customRoles.groupCount', { count: permissions.length })}
                        </p>
                      </div>
                      <div className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                        allSelected
                          ? 'border-primary bg-primary'
                          : someSelected
                            ? 'border-primary bg-primary/30'
                            : 'border-grey-300 bg-surface',
                      )}>
                        {(allSelected || someSelected) && <Check size={12} className="text-white" strokeWidth={3} />}
                      </div>
                    </button>

                    <div className="divide-y divide-border">
                      {permissions.map(permission => (
                        <button
                          key={permission}
                          type="button"
                          onClick={() => togglePermission(permission)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-grey-50/60"
                        >
                          <span className="text-xs text-text-secondary">
                            {t(`customRoles.perms.${permission}` as any, { defaultValue: permission })}
                          </span>
                          <div className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                            selectedPerms.includes(permission)
                              ? 'border-primary bg-primary'
                              : 'border-grey-300 bg-surface',
                          )}>
                            {selectedPerms.includes(permission) && <Check size={12} className="text-white" strokeWidth={3} />}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader>
            <CardTitle>{t('customRoles.permissionSummary')}</CardTitle>
            <CardDescription>{t('customRoles.selectedPermissions', { count: selectedPerms.length })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedPerms.length === 0 ? (
              <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                {t('customRoles.atLeastOnePermission')}
              </p>
            ) : (
              <div className="flex max-h-72 flex-wrap gap-1 overflow-y-auto pr-1">
                {selectedPerms.map(permission => (
                  <span key={permission} className="inline-flex items-center rounded-md border border-grey-100 bg-grey-50 px-2 py-1 text-[11px] font-medium text-text-secondary">
                    {t(`customRoles.perms.${permission}` as any, { defaultValue: permission })}
                  </span>
                ))}
              </div>
            )}

            {mutation.error && (
              <p className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                {(mutation.error as Error).message}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" loading={mutation.isPending} disabled={selectedPerms.length === 0}>
                <Save size={14} />{t('common.save')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => navigate('/custom-roles')}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}
