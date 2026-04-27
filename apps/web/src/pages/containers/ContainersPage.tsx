import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Plus, Box, Layers, Trash2, X, Copy, Check,
  GitBranch, RotateCcw, ScrollText, Square, Play,
  AlertTriangle,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Card } from '@/components/ui/card'
import { useTranslation } from 'react-i18next'
import { CreateContainerSchema, CreateStackSchema, type CreateContainerInput, type CreateStackInput } from '@zoneploy/types'
import { containersApi, type ContainerItem } from '@/api/containers'
import { stacksApi, type StackItem } from '@/api/stacks'
import { domainsApi } from '@/api/domains'
import { plansApi } from '@/api/plans'
import { projectsApi } from '@/api/projects'
import { environmentsApi } from '@/api/environments'
import { serversApi } from '@/api/servers'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { LoadingState } from '@/components/ui/spinner'
import { Dialog } from '@/components/ui/dialog'
import { ContainerStatusBadge } from '@/components/shared/ContainerStatusBadge'
import { PageHeader } from '@/components/shared/PageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { hasReachedPlanLimit } from '@/lib/plan-limits'

/** registry.host/org/name:tag -> registry.host/tag */
function formatImage(image: string | null): string {
  if (!image) return '—'
  const hostMatch = image.match(/^([^/]+)\//)
  const tagMatch = image.match(/:([^:]+)$/)
  if (hostMatch && tagMatch) return `${hostMatch[1]}/${tagMatch[1]}`
  return image
}

// Generic selector

function getStackImageFromCompose(composeContent: string | null): string | null {
  if (!composeContent) return null

  const imageMatch = composeContent.match(/^\s*image:\s*["']?([^"'\r\n]+)["']?\s*$/m)
  return imageMatch?.[1] ?? null
}

function SelectField({
  label, value, onChange, disabled, placeholder, children, error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder: string
  children: React.ReactNode
  error?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{placeholder}</option>
        {children}
      </Select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

// Cascading selectors: project to environment to server.

function ResourceSelectors({
  orgId,
  projectId, setProjectId,
  environmentId, setEnvironmentId,
  serverId, setServerId,
  errors,
}: {
  orgId: string
  projectId: string
  setProjectId: (v: string) => void
  environmentId: string
  setEnvironmentId: (v: string) => void
  serverId: string
  setServerId: (v: string) => void
  errors?: { environmentId?: string; serverId?: string }
}) {
  const { t } = useTranslation()

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => projectsApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: envs = [] } = useQuery({
    queryKey: ['environments-for-form', orgId, projectId],
    queryFn: () => environmentsApi.list(orgId, projectId),
    enabled: !!orgId && !!projectId,
  })

  const { data: servers = [] } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
  })

  const onlineServers = servers.filter(s => s.status === 'online')

  return (
    <>
      <SelectField
        label={t('containers.project')}
        value={projectId}
        onChange={v => { setProjectId(v); setEnvironmentId('') }}
        placeholder={t('containers.selectProject')}
      >
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </SelectField>

      <SelectField
        label={t('containers.environment')}
        value={environmentId}
        onChange={setEnvironmentId}
        disabled={!projectId}
        placeholder={projectId ? t('containers.selectEnvironment') : t('containers.selectProjectFirst')}
        error={errors?.environmentId}
      >
        {envs.map(e => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </SelectField>

      <SelectField
        label={t('containers.server')}
        value={serverId}
        onChange={setServerId}
        placeholder={onlineServers.length === 0 ? t('containers.noOnlineServers') : t('containers.selectServer')}
        disabled={onlineServers.length === 0}
        error={errors?.serverId}
      >
        {onlineServers.map(s => (
          <option key={s.id} value={s.id}>{s.name} ({s.ipAddress})</option>
        ))}
      </SelectField>
    </>
  )
}

// Container creation form

function CreateContainerForm({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [extraPorts, setExtraPorts] = useState<Array<{ id: string; value: string }>>([])
  const [deployToken, setDeployToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [environmentId, setEnvironmentId] = useState('')
  const [serverId, setServerId] = useState('')
  const [formError, setFormError] = useState('')

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<CreateContainerInput>({
    resolver: zodResolver(CreateContainerSchema),
    defaultValues: { port: 3000 },
  })

  const { data: subscription } = useQuery({
    queryKey: ['subscription', orgId],
    queryFn: () => plansApi.getSubscription(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  })

  const handleSetEnvironmentId = (v: string) => {
    setEnvironmentId(v)
    setValue('environmentId', v as `${string}-${string}-${string}-${string}-${string}`)
  }
  const handleSetServerId = (v: string) => {
    setServerId(v)
    setValue('serverId', v as `${string}-${string}-${string}-${string}-${string}`)
  }

  const copyToken = () => {
    if (!deployToken) return
    navigator.clipboard.writeText(deployToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const getValidExtraPorts = () =>
    extraPorts
      .map(p => parseInt(p.value))
      .filter(p => !isNaN(p) && p >= 1 && p <= 65535)

  const create = useMutation({
    mutationFn: async (data: CreateContainerInput) => {
      const result = await containersApi.create(orgId, data)
      const validPorts = getValidExtraPorts()
      if (validPorts.length > 0) {
        await Promise.all(validPorts.map(port => domainsApi.addZoneploy(orgId, result.id, port)))
      }
      return result
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['containers', orgId] })
      queryClient.invalidateQueries({ queryKey: ['subscription', orgId] })
      setDeployToken(result.deployToken)
    },
  })

  const onSubmit = (data: CreateContainerInput) => {
    setFormError('')
    const validPorts = getValidExtraPorts()
    if (subscription && subscription.maxSubdomains !== -1) {
      const remainingSubdomains = Math.max(0, subscription.maxSubdomains - subscription.usage.subdomains)
      if (validPorts.length > remainingSubdomains) {
        setFormError(t('containers.extraPortsPlanLimitReached', {
          remaining: remainingSubdomains,
          used: subscription.usage.subdomains,
          max: subscription.maxSubdomains,
        }))
        return
      }
    }
    create.mutate(data)
  }

  if (deployToken) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-success">{t('containers.deployTokenCreated')}</p>
          <p className="text-xs text-text-secondary">{t('containers.deployTokenCreatedMsg')}</p>
          <div className="flex items-center gap-2 bg-background rounded-md px-3 py-2 font-mono text-xs text-text-primary break-all mt-2">
            <span className="flex-1 select-all">{deployToken}</span>
            <button onClick={copyToken} className="shrink-0 text-text-secondary hover:text-text-primary transition-colors">
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-text-secondary">
          {t('containers.deployTokenHint', { secret: 'ZP_DEPLOY_TOKEN' })}
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, errs => console.error('[CreateContainer]', errs))} className="space-y-4">
      {(create.error || formError) && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {formError || (create.error as Error).message}
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t('containers.name')}</Label>
        <Input placeholder={t('containers.namePlaceholder')} {...register('name')} error={errors.name?.message} />
      </div>

      <ResourceSelectors
        orgId={orgId}
        projectId={projectId} setProjectId={setProjectId}
        environmentId={environmentId} setEnvironmentId={handleSetEnvironmentId}
        serverId={serverId} setServerId={handleSetServerId}
      />

      <div className="space-y-1.5">
        <Label>{t('containers.port')}</Label>
        <Input type="number" placeholder="3000" {...register('port', { valueAsNumber: true })} error={errors.port?.message} />
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-medium text-amber-900">
          Containers are intended for stateless workloads. Use Stacks for databases or persistent storage.
        </p>
      </div>

      {extraPorts.length > 0 && (
        <div className="space-y-2">
          {extraPorts.map(ep => (
            <div key={ep.id} className="flex items-center gap-2">
              <Input
                type="number" placeholder="8080"
                value={ep.value}
                onChange={e => setExtraPorts(prev => prev.map(p => p.id === ep.id ? { ...p, value: e.target.value } : p))}
                className="flex-1"
              />
              <button type="button" onClick={() => setExtraPorts(prev => prev.filter(p => p.id !== ep.id))}
                className="text-text-secondary hover:text-red-400 transition-colors">
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => setExtraPorts(prev => [...prev, { id: crypto.randomUUID(), value: '' }])}
        className="text-xs text-primary hover:text-primary/80 transition-colors">
        + {t('containers.addPort')}
      </button>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={create.isPending}>
          <Box size={14} />{t('containers.create')}
        </Button>
      </div>
    </form>
  )
}

// Stack creation form

function CreateStackForm({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [deployToken, setDeployToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [projectId, setProjectId] = useState('')
  const [environmentId, setEnvironmentId] = useState('')
  const [serverId, setServerId] = useState('')
  const [formError, setFormError] = useState('')

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<CreateStackInput>({
    resolver: zodResolver(CreateStackSchema),
  })

  const handleSetEnvironmentId = (v: string) => {
    setEnvironmentId(v)
    setValue('environmentId', v as `${string}-${string}-${string}-${string}-${string}`)
  }
  const handleSetServerId = (v: string) => {
    setServerId(v)
    setValue('serverId', v as `${string}-${string}-${string}-${string}-${string}`)
  }

  const copyToken = () => {
    if (!deployToken) return
    navigator.clipboard.writeText(deployToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const create = useMutation({
    mutationFn: (data: CreateStackInput) => stacksApi.create(orgId, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['stacks', orgId] })
      queryClient.invalidateQueries({ queryKey: ['subscription', orgId] })
      setDeployToken(result.deployToken)
    },
  })

  const onSubmit = (data: CreateStackInput) => {
    setFormError('')
    create.mutate(data)
  }

  if (deployToken) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-2">
          <p className="text-sm font-semibold text-success">{t('stacks.deployTokenCreated')}</p>
          <p className="text-xs text-text-secondary">{t('stacks.deployTokenCreatedMsg')}</p>
          <div className="flex items-center gap-2 bg-background rounded-md px-3 py-2 font-mono text-xs text-text-primary break-all mt-2">
            <span className="flex-1 select-all">{deployToken}</span>
            <button onClick={copyToken} className="shrink-0 text-text-secondary hover:text-text-primary transition-colors">
              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-text-secondary">
          {t('containers.deployTokenHint', { secret: 'ZP_DEPLOY_TOKEN' })}
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit, errs => console.error('[CreateStack]', errs))} className="space-y-4">
      {(create.error || formError) && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
          {formError || (create.error as Error).message}
        </div>
      )}

      <div className="space-y-1.5">
        <Label>{t('stacks.name')}</Label>
        <Input placeholder={t('stacks.namePlaceholder')} {...register('name')} error={errors.name?.message} />
      </div>

      <ResourceSelectors
        orgId={orgId}
        projectId={projectId} setProjectId={setProjectId}
        environmentId={environmentId} setEnvironmentId={handleSetEnvironmentId}
        serverId={serverId} setServerId={handleSetServerId}
      />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" loading={create.isPending}>
          <Layers size={14} />{t('stacks.create')}
        </Button>
      </div>
    </form>
  )
}

// Container card

function ContainerCard({
  container,
  orgId,
  canManage,
  environmentColors,
}: {
  container: ContainerItem
  orgId: string
  canManage: boolean
  environmentColors: Record<string, string | null>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const publicHost = container.domain?.hostname
  const { data: domainMappings } = useQuery({
    queryKey: ['container-domain-mappings', orgId, container.id],
    queryFn: () => domainsApi.listAll(orgId, container.id),
    enabled: !!orgId,
    staleTime: 30_000,
  })

  const stop = useMutation({ mutationFn: () => containersApi.stop(orgId, container.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['containers', orgId] }) })
  const start = useMutation({ mutationFn: () => containersApi.start(orgId, container.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['containers', orgId] }) })
  const restart = useMutation({ mutationFn: () => containersApi.restart(orgId, container.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['containers', orgId] }) })
  const remove = useMutation({
    mutationFn: () => containersApi.delete(orgId, container.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers', orgId] })
      queryClient.invalidateQueries({ queryKey: ['subscription', orgId] })
    },
  })

  useQuery({
    queryKey: ['containers', orgId, container.id],
    queryFn: () => containersApi.get(orgId, container.id),
    enabled: container.status === 'deploying',
    refetchInterval: container.status === 'deploying' ? 3000 : false,
    select: data => { if (data.status !== 'deploying') queryClient.invalidateQueries({ queryKey: ['containers', orgId] }); return data },
  })

  const allPorts = [
    ...(domainMappings?.zoneploy ?? []).map(mapping => mapping.port),
    ...(domainMappings?.custom ?? []).map(mapping => mapping.port),
  ]
  const portCount = Math.max(1, new Set(allPorts).size || 0)
  const domainCount = domainMappings
    ? (domainMappings.zoneploy.length + domainMappings.custom.length)
    : (publicHost ? 1 : 0)
  const environmentColor = container.environmentId ? environmentColors[container.environmentId] : null
  const iconTone =
    container.status === 'running'
      ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200'
      : container.status === 'stopped'
        ? 'bg-amber-100 text-amber-600 ring-1 ring-amber-200'
      : container.status === 'error'
          ? 'bg-red-100 text-red-500 ring-1 ring-red-200'
      : container.status === 'waiting'
            ? 'bg-violet-100 text-violet-500 ring-1 ring-violet-200'
            : 'bg-grey-50 text-text-secondary ring-1 ring-grey-100'

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-grey-100 bg-background-paper transition-colors hover:border-primary/30">
        <div className="relative z-10 flex items-start justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`rounded-xl p-2.5 shrink-0 ${iconTone}`}>
              <Box size={16} strokeWidth={1.8} />
            </div>

            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-text-primary">
                  {container.name}
                </h3>
                <ContainerStatusBadge status={container.status} />
              </div>

              {container.image && (
                <p className="truncate font-mono text-xs text-text-secondary">
                  {formatImage(container.image)}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {container.projectName && (
                  <span className="inline-flex items-center rounded-full border border-grey-100 bg-grey-25 px-2 py-1 text-[11px] font-medium text-text-secondary">
                    {container.projectName}
                  </span>
                )}
                {container.environmentName && (
                  <span
                    className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium"
                    style={{
                      borderColor: environmentColor ?? 'rgb(229 231 235)',
                      color: environmentColor ?? 'var(--color-text-secondary)',
                      backgroundColor: environmentColor ? `${environmentColor}18` : 'rgb(249 250 251)',
                    }}
                  >
                    {container.environmentName}
                  </span>
                )}
                <span className="inline-flex items-center rounded-full border border-grey-100 bg-grey-25 px-2 py-1 text-[11px] font-medium text-text-secondary">
                  {portCount} {portCount === 1 ? t('containers.portCountOne') : t('containers.portCountOther')}
                </span>
                <span className="inline-flex items-center rounded-full border border-grey-100 bg-grey-25 px-2 py-1 text-[11px] font-medium text-text-secondary">
                  {domainCount} {domainCount === 1 ? t('containers.domainCountOne') : t('containers.domainCountOther')}
                </span>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              {container.status === 'running' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => stop.mutate()}
                  loading={stop.isPending}
                  className="text-text-secondary hover:text-amber-400"
                  title={t('containers.stop')}
                >
                  <Square size={14} />
                </Button>
              )}
              {container.status === 'stopped' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => start.mutate()}
                  loading={start.isPending}
                  className="text-text-secondary hover:text-emerald-400"
                  title={t('containers.start')}
                >
                  <Play size={14} />
                </Button>
              )}
              {container.status === 'running' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => restart.mutate()}
                  loading={restart.isPending}
                  className="text-text-secondary hover:text-text-primary"
                  title={t('containers.restart')}
                >
                  <RotateCcw size={14} />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfirmDelete(true)}
                loading={remove.isPending}
                className="text-text-secondary hover:text-red-400"
                title={t('common.delete')}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          )}
        </div>

        {container.status === 'error' && container.errorReason && (
          <div className="relative z-10 border-t border-red-400/20 bg-red-400/5 px-4 py-2.5">
            <p className="text-xs text-red-400">{container.errorReason}</p>
          </div>
        )}

        <div className="relative z-10 flex items-center justify-between border-t border-grey-100 px-4 py-2.5 text-xs text-text-secondary">
          <div className="min-w-0 truncate">
            {container.environmentName || container.serverName || container.projectName || ' '}
          </div>
          <Link
            to={`/containers/${container.id}`}
            className="flex shrink-0 items-center gap-1 text-text-secondary transition-colors hover:text-text-primary"
          >
            {container.status === 'waiting' ? <GitBranch size={11} /> : <ScrollText size={11} />}
            <span>{container.status === 'waiting' ? t('containers.setupCicd') : t('containers.view')}</span>
          </Link>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={t('containers.deleteConfirmTitle')}
          message={t('containers.deleteConfirmMsg', { name: container.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => { setConfirmDelete(false); remove.mutate() }}
          onCancel={() => setConfirmDelete(false)}
          loading={remove.isPending}
          danger
        />
      )}
    </>
  )
}

// Stack card

function StackCard({
  stack,
  orgId,
  canManage,
  environmentColors,
}: {
  stack: StackItem
  orgId: string
  canManage: boolean
  environmentColors: Record<string, string | null>
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: services = [] } = useQuery({
    queryKey: ['stack-card-services', orgId, stack.id],
    queryFn: () => stacksApi.listServices(orgId, stack.id),
    enabled: !!orgId && stack.status !== 'created',
    staleTime: 15_000,
    refetchInterval: stack.status === 'running' ? 10_000 : false,
  })

  const stop = useMutation({ mutationFn: () => stacksApi.stop(orgId, stack.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stacks', orgId] }) })
  const start = useMutation({ mutationFn: () => stacksApi.start(orgId, stack.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stacks', orgId] }) })
  const remove = useMutation({
    mutationFn: () => stacksApi.delete(orgId, stack.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks', orgId] })
      queryClient.invalidateQueries({ queryKey: ['subscription', orgId] })
    },
  })
  const startService = useMutation({
    mutationFn: (serviceName: string) => stacksApi.startService(orgId, stack.id, serviceName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stack-card-services', orgId, stack.id] })
    },
  })
  const stopService = useMutation({
    mutationFn: (serviceName: string) => stacksApi.stopService(orgId, stack.id, serviceName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stack-card-services', orgId, stack.id] })
    },
  })
  const restartService = useMutation({
    mutationFn: (serviceName: string) => stacksApi.restartService(orgId, stack.id, serviceName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stacks', orgId] })
      queryClient.invalidateQueries({ queryKey: ['stack-card-services', orgId, stack.id] })
    },
  })

  const statusColor: Record<StackItem['status'], string> = {
    created: 'text-violet-400',
    deploying: 'text-amber-400',
    running: 'text-emerald-400',
    partial: 'text-sky-500',
    stopped: 'text-amber-400',
    error: 'text-red-400',
  }
  const stackIconTone =
    stack.status === 'running'
      ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-200'
      : stack.status === 'partial'
        ? 'bg-sky-100 text-sky-600 ring-1 ring-sky-200'
      : stack.status === 'stopped'
        ? 'bg-amber-100 text-amber-600 ring-1 ring-amber-200'
        : stack.status === 'created'
          ? 'bg-violet-100 text-violet-500 ring-1 ring-violet-200'
          : stack.status === 'deploying'
            ? 'bg-amber-100 text-amber-600 ring-1 ring-amber-200'
            : stack.status === 'error'
              ? 'bg-red-100 text-red-500 ring-1 ring-red-200'
              : 'bg-grey-50 text-text-secondary ring-1 ring-grey-100'

  const stackStatusLabel =
    stack.status === 'created'
      ? t('containers.status.waiting')
      : t(`stacks.status.${stack.status}`)

  const stackSubtitle = formatImage(getStackImageFromCompose(stack.composeContent))
  const stackEnvironmentColor = stack.environmentId ? environmentColors[stack.environmentId] : null
  const visibleServices = services.slice(0, 3)
  const hiddenServicesCount = Math.max(0, services.length - visibleServices.length)

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-grey-100 bg-background-paper transition-colors hover:border-primary/30">
        <Link
          to={`/stacks/${stack.id}`}
          aria-label={stack.name}
          className="absolute inset-0 z-0"
        />

        <div className="relative z-10 flex items-start justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={`rounded-xl p-2.5 shrink-0 ${stackIconTone}`}>
              <Layers size={16} strokeWidth={1.8} className="text-current" />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold text-text-primary">
                  {stack.name}
                </h3>
                <span className={`text-xs font-medium ${statusColor[stack.status]}`}>
                  {stackStatusLabel}
                </span>
              </div>
              <p className="truncate font-mono text-xs text-text-secondary">
                {stackSubtitle}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                {stack.projectDisplayName && (
                  <span className="inline-flex items-center rounded-full border border-grey-100 bg-grey-25 px-2 py-1 text-[11px] font-medium text-text-secondary">
                    {stack.projectDisplayName}
                  </span>
                )}
                {stack.environmentName && (
                  <span
                    className="inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium"
                    style={{
                      borderColor: stackEnvironmentColor ?? 'rgb(229 231 235)',
                      color: stackEnvironmentColor ?? 'var(--color-text-secondary)',
                      backgroundColor: stackEnvironmentColor ? `${stackEnvironmentColor}18` : 'rgb(249 250 251)',
                    }}
                  >
                    {stack.environmentName}
                  </span>
                )}
                {services.length > 0 && (
                  <span className="rounded-full border border-grey-100 bg-grey-25 px-2 py-1 text-[11px] font-medium">
                    {services.length} {services.length === 1 ? t('stacks.serviceCountOne') : t('stacks.serviceCountOther')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {canManage && (
            <div className="flex shrink-0 items-center gap-1">
              {(stack.status === 'running' || stack.status === 'partial') && <Button variant="ghost" size="icon" onClick={() => stop.mutate()} loading={stop.isPending} className="text-text-secondary hover:text-amber-400" title={t('stacks.stop')}><Square size={14} /></Button>}
              {stack.status === 'stopped' && <Button variant="ghost" size="icon" onClick={() => start.mutate()} loading={start.isPending} className="text-text-secondary hover:text-emerald-400" title={t('stacks.start')}><Play size={14} /></Button>}
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} loading={remove.isPending} className="text-text-secondary hover:text-red-400" title={t('common.delete')}><Trash2 size={14} /></Button>
            </div>
          )}
        </div>

        {visibleServices.length > 0 && (
          <div className="relative z-10 border-t border-grey-100 px-4 py-3">
            <div className="space-y-1.5">
              {visibleServices.map(service => {
                const serviceStatusColor =
                  service.status === 'running'
                    ? 'text-emerald-400'
                    : service.status === 'restarting'
                      ? 'text-amber-400'
                      : service.status === 'stopped'
                        ? 'text-amber-400'
                        : 'text-text-secondary'

                return (
                  <div
                    key={service.serviceName}
                    className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          service.status === 'running'
                            ? 'bg-emerald-400'
                            : service.status === 'restarting'
                              ? 'bg-amber-400'
                              : service.status === 'stopped'
                                ? 'bg-amber-400'
                                : 'bg-grey-300'
                        }`} />
                        <p className="truncate text-sm font-medium text-text-primary">{service.serviceName}</p>
                      </div>
                      <p className={`pl-3.5 text-[11px] font-medium ${serviceStatusColor}`}>{service.status}</p>
                    </div>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-1">
                        {service.status === 'stopped' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => startService.mutate(service.serviceName)}
                            loading={startService.isPending && startService.variables === service.serviceName}
                            className="text-text-secondary hover:text-emerald-400"
                            title={t('stacks.start')}
                          >
                            <Play size={13} />
                          </Button>
                        )}
                        {service.status === 'running' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => stopService.mutate(service.serviceName)}
                            loading={stopService.isPending && stopService.variables === service.serviceName}
                            className="text-text-secondary hover:text-amber-400"
                            title={t('stacks.stop')}
                          >
                            <Square size={13} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => restartService.mutate(service.serviceName)}
                          loading={restartService.isPending && restartService.variables === service.serviceName}
                          className="text-text-secondary hover:text-text-primary"
                          title={t('containers.restart')}
                        >
                          <RotateCcw size={13} />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {stack.status === 'error' && stack.errorReason && (
          <div className="relative z-10 border-t border-red-400/20 bg-red-400/5 px-4 py-2.5"><p className="text-xs text-red-400">{stack.errorReason}</p></div>
        )}

        <div className="relative z-10 flex items-center justify-between border-t border-grey-100 px-4 py-2.5 text-xs text-text-secondary">
          <div className="min-w-0 truncate">
            {hiddenServicesCount > 0 ? `+${hiddenServicesCount}` : ' '}
          </div>
          <Link
            to={stack.status === 'created' ? `/stacks/${stack.id}?tab=cicd` : `/stacks/${stack.id}`}
            className="flex items-center gap-1 text-text-secondary transition-colors hover:text-text-primary"
          >
            {stack.status === 'created' ? <GitBranch size={11} /> : <ScrollText size={11} />}
            {stack.status === 'created' ? t('containers.setupCicd') : t('stacks.view')}
          </Link>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={t('stacks.deleteConfirmTitle')}
          message={t('stacks.deleteConfirmMsg', { name: stack.name })}
          confirmLabel={t('common.delete')}
          onConfirm={() => { setConfirmDelete(false); remove.mutate() }}
          onCancel={() => setConfirmDelete(false)}
          loading={remove.isPending}
          danger
        />
      )}
    </>
  )
}

// Main page

export function ContainersPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showCreate, setShowCreate] = useState(false)
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const canManage = can('containers:write')
  const tab: 'containers' | 'stacks' = searchParams.get('view') === 'stacks' ? 'stacks' : 'containers'

  const { data: containers = [], isLoading: loadingContainers } = useQuery({
    queryKey: ['containers', orgId],
    queryFn: () => containersApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: stacks = [], isLoading: loadingStacks } = useQuery({
    queryKey: ['stacks', orgId],
    queryFn: () => stacksApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: subscription } = useQuery({
    queryKey: ['subscription', orgId],
    queryFn: () => plansApi.getSubscription(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  })
  const { data: environmentColors = {} } = useQuery({
    queryKey: ['environment-colors', orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const projects = await projectsApi.list(orgId)
      const envGroups = await Promise.all(
        projects.map(project =>
          environmentsApi.list(orgId, project.id).catch(() => []),
        ),
      )

      return envGroups.flat().reduce<Record<string, string | null>>((acc, env) => {
        acc[env.id] = env.color
        return acc
      }, {})
    },
    staleTime: 60_000,
  })

  const runningContainers = containers.filter(c => c.status === 'running' || c.status === 'deploying').length
  const runningStacks = stacks.filter(s => s.status === 'running' || s.status === 'partial' || s.status === 'deploying').length
  const usedDeployments = Math.max(subscription?.usage.deployments ?? 0, containers.length + stacks.length)
  const deploymentLimitReached = hasReachedPlanLimit(usedDeployments, subscription?.maxDeployments)

  const setTab = (nextTab: 'containers' | 'stacks') => {
    const params = new URLSearchParams(searchParams)
    params.set('view', nextTab)
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }

  const subtitle = tab === 'containers'
    ? [t('containers.count_running', { count: runningContainers }), t('containers.count_total', { count: containers.length })].join(' · ')
    : [t('stacks.count_running', { count: runningStacks }), t('stacks.count_total', { count: stacks.length })].join(' · ')

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('nav.deployments')}
        subtitle={subtitle}
        action={canManage && (
          <Button onClick={() => setShowCreate(true)} disabled={deploymentLimitReached}>
            <Plus size={14} />
            {tab === 'containers' ? t('containers.create') : t('stacks.create')}
          </Button>
        )}
      />

      {deploymentLimitReached && subscription && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
            <p className="text-sm text-amber-300">
              {t('containers.planLimitReached', { used: usedDeployments, max: subscription.maxDeployments })}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-grey-100">
        {(['containers', 'stacks'] as const).map(t2 => (
          <button
            key={t2}
            onClick={() => { setTab(t2); setShowCreate(false) }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t2
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t2 === 'containers' ? <Box size={14} /> : <Layers size={14} />}
            {t2 === 'containers' ? t('containers.tabLabel') : t('stacks.tabLabel')}
            <span className="text-xs bg-grey-50 text-text-secondary rounded-full px-1.5 py-0.5 font-mono">
              {t2 === 'containers' ? containers.length : stacks.length}
            </span>
          </button>
        ))}
      </div>

      {/* Active tab content. */}
      {tab === 'containers' && (
        loadingContainers ? <LoadingState /> :
        containers.length === 0 ? (
          <Card>
            <EmptyState icon={Box} title={t('containers.empty')} subtitle={t('containers.emptySubtitle')}
              action={canManage && !deploymentLimitReached ? { label: t('containers.create'), onClick: () => setShowCreate(true), icon: <Plus size={13} /> } : undefined}
            />
          </Card>
        ) : (
          <div className="grid gap-4">
            {containers.map(c => (
              <ContainerCard
                key={c.id}
                container={c}
                orgId={orgId}
                canManage={canManage}
                environmentColors={environmentColors}
              />
            ))}
          </div>
        )
      )}

      {tab === 'stacks' && (
        loadingStacks ? <LoadingState /> :
        stacks.length === 0 ? (
          <Card>
            <EmptyState icon={Layers} title={t('stacks.empty')} subtitle={t('stacks.emptySubtitle')}
              action={canManage && !deploymentLimitReached ? { label: t('stacks.create'), onClick: () => setShowCreate(true), icon: <Plus size={13} /> } : undefined}
            />
          </Card>
        ) : (
          <div className="grid gap-4">
            {stacks.map(s => (
              <StackCard
                key={s.id}
                stack={s}
                orgId={orgId}
                canManage={canManage}
                environmentColors={environmentColors}
              />
            ))}
          </div>
        )
      )}

      {/* Creation dialogs. */}
      <Dialog
        open={showCreate && tab === 'containers'}
        onClose={() => setShowCreate(false)}
        title={t('containers.dialogTitle')}
        description={t('containers.dialogSubtitle')}
        className="max-w-lg"
      >
        <CreateContainerForm orgId={orgId} onClose={() => setShowCreate(false)} />
      </Dialog>

      <Dialog
        open={showCreate && tab === 'stacks'}
        onClose={() => setShowCreate(false)}
        title={t('stacks.dialogTitle')}
        description={t('stacks.dialogSubtitle')}
        className="max-w-lg"
      >
        <CreateStackForm orgId={orgId} onClose={() => setShowCreate(false)} />
      </Dialog>
    </div>
  )
}
