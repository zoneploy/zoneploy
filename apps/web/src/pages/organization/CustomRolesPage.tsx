import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Pencil, Trash2, Shield } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { customRolesApi, type CustomRole } from '@/api/customRoles'
import { organizationsApi } from '@/api/organizations'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { LoadingState } from '@/components/ui/spinner'

export function CustomRolesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const queryClient = useQueryClient()
  const [deleteRole, setDeleteRole] = useState<CustomRole | null>(null)

  const { can } = usePermissions()
  const canManage = can('members:manage')

  const { data: org } = useQuery({
    queryKey: ['organization', orgId],
    queryFn: () => organizationsApi.get(orgId),
    enabled: !!orgId,
  })
  const isFreePlan = org?.subscription?.planSlug === 'free'
  const canManagePaidFeature = canManage && !isFreePlan

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['custom-roles', orgId],
    queryFn: () => customRolesApi.list(orgId),
    enabled: !!orgId,
  })

  const remove = useMutation({
    mutationFn: () => customRolesApi.delete(orgId, deleteRole!.id),
    onSuccess: () => {
      queryClient.setQueryData<CustomRole[]>(['custom-roles', orgId], old =>
        old?.filter(r => r.id !== deleteRole?.id) ?? [],
      )
      setDeleteRole(null)
    },
  })

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('customRoles.title')}
        subtitle={t('customRoles.subtitle')}
        action={canManagePaidFeature && (
          <Button onClick={() => navigate('/custom-roles/new')}>
            <Plus size={14} />{t('customRoles.create')}
          </Button>
        )}
      />

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Shield size={16} className="text-primary" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t('customRoles.title')}</p>
            <p className="text-xs text-text-secondary">{t('customRoles.count', { count: roles.length })}</p>
          </div>
        </div>

        <div className="border-t border-border">
          {isLoading ? (
            <LoadingState />
          ) : roles.length === 0 ? (
            <EmptyState
              icon={Shield}
              title={t('customRoles.empty')}
              subtitle={isFreePlan ? t('customRoles.paidPlanOnlySubtitle') : t('customRoles.emptySubtitle')}
              action={canManagePaidFeature ? { label: t('customRoles.create'), onClick: () => navigate('/custom-roles/new'), icon: <Plus size={13} /> } : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-text-disabled">{t('common.name')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled">{t('customRoles.permissions')}</th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {roles.map(role => (
                    <tr key={role.id} className="hover:bg-grey-50/40 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-medium text-text-primary">{role.name}</p>
                        {role.description && (
                          <p className="text-xs text-text-secondary mt-0.5 truncate max-w-sm">{role.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.slice(0, 4).map(perm => (
                            <span key={perm} className="inline-flex items-center rounded-md bg-grey-50 border border-grey-100 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                              {t(`customRoles.perms.${perm}` as any, { defaultValue: perm })}
                            </span>
                          ))}
                          {role.permissions.length > 4 && (
                            <span className="inline-flex items-center rounded-md bg-grey-50 border border-grey-100 px-2 py-0.5 text-[10px] text-text-disabled">
                              +{role.permissions.length - 4}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {canManagePaidFeature && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost" size="icon"
                              className="h-7 w-7 text-text-disabled hover:text-text-primary"
                              onClick={() => navigate(`/custom-roles/${role.id}/edit`)}
                            >
                              <Pencil size={13} />
                            </Button>
                            <Button
                              variant="ghost" size="icon"
                              className="h-7 w-7 text-text-disabled hover:text-destructive"
                              onClick={() => setDeleteRole(role)}
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {deleteRole && (
        <ConfirmDialog
          title={t('customRoles.deleteTitle')}
          message={t('customRoles.deleteMsg')}
          confirmLabel={t('common.delete')}
          onConfirm={() => remove.mutate()}
          onCancel={() => { setDeleteRole(null); remove.reset() }}
          loading={remove.isPending}
          error={remove.error ? (remove.error as Error).message : undefined}
          danger
        />
      )}
    </div>
  )
}
