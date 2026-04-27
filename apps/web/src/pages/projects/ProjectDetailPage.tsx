import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Plus, Layers, Lock, Pencil, Trash2, Key, X, Eye, EyeOff, ChevronRight, Box,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useForm } from 'react-hook-form'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { projectsApi } from '@/api/projects'
import { environmentsApi, type Environment } from '@/api/environments'
import { containersApi } from '@/api/containers'
import { stacksApi } from '@/api/stacks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/spinner'
import { PageHeader } from '@/components/shared/PageHeader'

// Environment color selector

const ENV_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b']

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ENV_COLORS.map(color => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
            value === color ? 'border-white ring-2 ring-offset-1 ring-offset-background-paper' : 'border-transparent',
          )}
          style={{ backgroundColor: color, '--tw-ring-color': color } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

// Environment form

interface EnvFormValues {
  name: string
  color: string
  isProtected: boolean
}

function EnvironmentForm({
  initial, onSubmit, onClose, loading,
}: {
  initial?: Environment
  onSubmit: (data: EnvFormValues) => void
  onClose: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<EnvFormValues>({
    defaultValues: {
      name: initial?.name ?? '',
      color: initial?.color ?? ENV_COLORS[0]!,
      isProtected: initial?.isProtected ?? false,
    },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="env-name">{t('environments.name')}</Label>
        <Input
          id="env-name"
          placeholder={t('environments.namePlaceholder')}
          {...register('name', { required: true })}
        />
        {errors.name && <p className="text-xs text-destructive">{t('common.error')}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>{t('environments.color')}</Label>
        <ColorPicker value={watch('color')} onChange={c => setValue('color', c)} />
      </div>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-grey-300 accent-primary"
          {...register('isProtected')}
        />
        <div>
          <p className="text-sm text-text-primary">{t('environments.isProtected')}</p>
          <p className="text-xs text-text-secondary">{t('environments.isProtectedHint')}</p>
        </div>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={loading}>{t('common.save')}</Button>
      </div>
    </form>
  )
}

// Environment secrets panel

function EnvSecretsPanel({
  orgId, projectId, env, onClose,
}: {
  orgId: string
  projectId: string
  env: Environment
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})

  const { data: secrets = [], isLoading } = useQuery({
    queryKey: ['env-secrets', orgId, projectId, env.id],
    queryFn: () => environmentsApi.listSecrets(orgId, projectId, env.id),
  })

  const upsert = useMutation({
    mutationFn: () => environmentsApi.upsertSecret(orgId, projectId, env.id, newKey.toUpperCase(), newValue),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['env-secrets', orgId, projectId, env.id] })
      setNewKey('')
      setNewValue('')
    },
  })

  const remove = useMutation({
    mutationFn: (key: string) => environmentsApi.deleteSecret(orgId, projectId, env.id, key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['env-secrets', orgId, projectId, env.id] }),
  })

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-background-paper border-l border-grey-100 shadow-darker-md flex flex-col" style={{ zIndex: 9999 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-grey-100">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: env.color ?? '#6366f1' }} />
          <h2 className="text-sm font-semibold text-text-primary">{env.name}</h2>
          {env.isProtected && (
            <Lock size={12} className="text-warning" />
          )}
        </div>
        <button onClick={onClose} className="text-text-disabled hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      <p className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-disabled border-b border-grey-100/60">
        {t('environments.secrets')}
      </p>

      {/* Secrets list. */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <LoadingState className="py-8" />
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Key size={20} className="text-text-disabled" strokeWidth={1.4} />
            <p className="text-sm text-text-secondary">{t('environments.secretsEmpty')}</p>
          </div>
        ) : (
          <div className="divide-y divide-grey-100/60">
            {secrets.map(secret => (
              <div key={secret.key} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-medium text-text-primary">{secret.key}</p>
                  <p className="text-xs text-text-disabled mt-0.5">
                    {showValues[secret.key] ? '••••••' : '••••••'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setShowValues(v => ({ ...v, [secret.key]: !v[secret.key] }))}
                    className="p-1 text-text-disabled hover:text-text-primary transition-colors"
                  >
                    {showValues[secret.key] ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-text-disabled hover:text-destructive"
                    loading={remove.isPending && remove.variables === secret.key}
                    onClick={() => remove.mutate(secret.key)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add secret. */}
      <div className="border-t border-grey-100 px-5 py-4 space-y-3">
        <p className="text-xs font-semibold text-text-secondary">{t('environments.secretsAdd')}</p>
        <div className="flex gap-2">
          <Input
            placeholder={t('environments.secretKey')}
            value={newKey}
            onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            className="font-mono text-xs flex-1"
            autoComplete="off"
          />
          <Input
            placeholder={t('environments.secretValue')}
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            className="text-xs flex-1"
            type="password"
            autoComplete="new-password"
          />
        </div>
        <Button
          size="sm"
          className="w-full"
          loading={upsert.isPending}
          disabled={!newKey || !newValue}
          onClick={() => upsert.mutate()}
        >
          <Plus size={13} />{t('environments.secretsAdd')}
        </Button>
      </div>
    </div>
  )
}

// Main page

export function ProjectDetailPage() {
  const { t } = useTranslation()
  const { projectId } = useParams<{ projectId: string }>()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [editEnv, setEditEnv] = useState<Environment | null>(null)
  const [deleteEnv, setDeleteEnv] = useState<Environment | null>(null)
  const [secretsEnv, setSecretsEnv] = useState<Environment | null>(null)

  const { can } = usePermissions()
  const canCreateEnvironment = can('environments:create')
  const canUpdateEnvironment = can('environments:update')
  const canDeleteEnvironment = can('environments:delete')

  const { data: project } = useQuery({
    queryKey: ['project', orgId, projectId],
    queryFn: () => projectsApi.get(orgId, projectId!),
    enabled: !!orgId && !!projectId,
  })

  const { data: envs = [], isLoading } = useQuery({
    queryKey: ['environments', orgId, projectId],
    queryFn: () => environmentsApi.list(orgId, projectId!),
    enabled: !!orgId && !!projectId,
  })

  const { data: allContainers = [] } = useQuery({
    queryKey: ['containers', orgId],
    queryFn: () => containersApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: allStacks = [] } = useQuery({
    queryKey: ['stacks', orgId],
    queryFn: () => stacksApi.list(orgId),
    enabled: !!orgId,
  })

  const create = useMutation({
    mutationFn: (data: EnvFormValues) => environmentsApi.create(orgId, projectId!, {
      name: data.name,
      color: data.color,
      isProtected: data.isProtected,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', orgId, projectId] })
      setCreateOpen(false)
    },
  })

  const update = useMutation({
    mutationFn: (data: EnvFormValues) => environmentsApi.update(orgId, projectId!, editEnv!.id, {
      name: data.name,
      color: data.color,
      isProtected: data.isProtected,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', orgId, projectId] })
      setEditEnv(null)
    },
  })

  const remove = useMutation({
    mutationFn: () => environmentsApi.delete(orgId, projectId!, deleteEnv!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments', orgId, projectId] })
      setDeleteEnv(null)
    },
  })

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={project?.name ?? '…'}
        subtitle={project?.description ?? undefined}
        action={canCreateEnvironment && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={14} />{t('environments.create')}
          </Button>
        )}
      />

      {/* Environments list. */}
      <Card className="p-0 overflow-hidden">
        {/* Cabecera */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Layers size={16} className="text-primary" strokeWidth={1.6} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('environments.title')}</p>
              <p className="text-xs text-text-secondary">{t('environments.count', { count: envs.length })}</p>
            </div>
          </div>
        </div>

        {/* Content. */}
        <div className="border-t border-border">
          {isLoading ? (
            <LoadingState />
          ) : envs.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={t('environments.empty')}
              subtitle={t('environments.emptySubtitle')}
              action={canCreateEnvironment ? { label: t('environments.create'), onClick: () => setCreateOpen(true), icon: <Plus size={13} /> } : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-text-disabled">{t('environments.name')}</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-disabled hidden sm:table-cell">{t('common.createdAt')}</th>
                    <th className="px-4 py-3 w-32" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {envs.map(env => {
                    const envContainers = allContainers.filter(c => c.environmentId === env.id)
                    const envStacks = allStacks.filter(s => s.environmentId === env.id)
                    return (
                    <tr key={env.id} className="hover:bg-grey-50/40 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `${env.color ?? '#6366f1'}20` }}
                          >
                            <Layers size={14} style={{ color: env.color ?? '#6366f1' }} strokeWidth={1.6} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-text-primary">{env.name}</p>
                              {env.isProtected && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 border border-warning/20 px-1.5 py-0.5 text-[10px] font-semibold text-warning shrink-0">
                                  <Lock size={9} />{t('environments.protected')}
                                </span>
                              )}
                            </div>
                            {(envContainers.length > 0 || envStacks.length > 0) && (
                              <div className="flex items-center gap-2 mt-0.5">
                                {envContainers.length > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-text-disabled">
                                    <Box size={9} />{envContainers.length} container{envContainers.length !== 1 ? 's' : ''}
                                  </span>
                                )}
                                {envStacks.length > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-text-disabled">
                                    <Layers size={9} />{envStacks.length} stack{envStacks.length !== 1 ? 's' : ''}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <span className="text-xs text-text-secondary">
                          {new Date(env.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setSecretsEnv(env)}
                            className="gap-1.5 text-xs"
                          >
                            <Key size={12} />{t('environments.secrets')}
                          </Button>
                          {(canUpdateEnvironment || canDeleteEnvironment) && (
                            <>
                              {canUpdateEnvironment && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-text-disabled hover:text-text-primary transition-opacity"
                                  onClick={() => setEditEnv(env)}
                                >
                                  <Pencil size={13} />
                                </Button>
                              )}
                              {canDeleteEnvironment && (
                                <Button
                                  variant="ghost" size="icon"
                                  className="h-7 w-7 text-text-disabled hover:text-destructive transition-opacity"
                                  onClick={() => setDeleteEnv(env)}
                                >
                                  <Trash2 size={13} />
                                </Button>
                              )}
                            </>
                          )}
                          <ChevronRight size={14} className="text-text-disabled ml-1 shrink-0" />
                        </div>
                      </td>
                    </tr>
                  )
                  })}

                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Create environment modal. */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t('environments.createTitle')}>
        <EnvironmentForm onSubmit={d => create.mutate(d)} onClose={() => setCreateOpen(false)} loading={create.isPending} />
      </Dialog>

      {/* Modal editar environment */}
      <Dialog open={!!editEnv} onClose={() => setEditEnv(null)} title={t('environments.editTitle')}>
        {editEnv && (
          <EnvironmentForm initial={editEnv} onSubmit={d => update.mutate(d)} onClose={() => setEditEnv(null)} loading={update.isPending} />
        )}
      </Dialog>

      {/* Delete environment modal. */}
      <Dialog open={!!deleteEnv} onClose={() => setDeleteEnv(null)} title={t('environments.deleteTitle')} description={t('environments.deleteMsg')}>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDeleteEnv(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>{t('common.delete')}</Button>
        </div>
      </Dialog>

      {/* Secrets panel rendered in body to avoid stacking conflicts with the topbar backdrop-filter. */}
      {secretsEnv && createPortal(
        <>
          <div className="fixed inset-0 bg-black/30" style={{ zIndex: 9998 }} onClick={() => setSecretsEnv(null)} />
          <EnvSecretsPanel
            orgId={orgId}
            projectId={projectId!}
            env={secretsEnv}
            onClose={() => setSecretsEnv(null)}
          />
        </>,
        document.body,
      )}
    </div>
  )
}
