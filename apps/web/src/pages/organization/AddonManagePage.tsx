import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Flame, Globe, Plus, Server, Trash2, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { addonsApi } from '@/api/addons'
import { serversApi } from '@/api/servers'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/spinner'
import { usePermissions } from '@/hooks/usePermissions'
import { getApiError } from '@/lib/errors'
import { useAuthStore } from '@/stores/auth'

function formatHealthValue(value: unknown) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function readPortList(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback

  const ports = value.filter((port): port is number =>
    typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535,
  )

  return ports.length > 0 ? Array.from(new Set(ports)).sort((a, b) => a - b) : fallback
}

function parseSingleTcpPort(value: string) {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return port
}

function parseTcpPortRows(rows: string[]) {
  const invalidRows = new Set<number>()
  const duplicateRows = new Set<number>()
  const seen = new Set<number>()
  const ports: number[] = []

  rows.forEach((row, index) => {
    const port = parseSingleTcpPort(row)
    if (!port) {
      invalidRows.add(index)
      return
    }

    if (seen.has(port)) {
      duplicateRows.add(index)
      return
    }

    seen.add(port)
    ports.push(port)
  })

  return {
    ports: ports.sort((a, b) => a - b),
    invalid: invalidRows.size > 0 || duplicateRows.size > 0,
    invalidRows,
    duplicateRows,
  }
}

interface FirewallBackendInfo {
  name: 'ufw' | 'firewalld'
  packageName: string
  serviceName: string
  installed: boolean
  active: boolean
  recommended: boolean
  canInstall: boolean
  canUninstall: boolean
}

interface FirewallPortUsage {
  port: number
  protocol: 'tcp'
  addonSlug?: string
  component: string
  description: string
  protected: boolean
  severity: 'info' | 'warning' | 'critical'
}

function readFirewallBackends(value: unknown): FirewallBackendInfo[] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as Record<string, unknown>
      if (candidate.name !== 'ufw' && candidate.name !== 'firewalld') return null
      return {
        name: candidate.name,
        packageName: typeof candidate.packageName === 'string' ? candidate.packageName : candidate.name,
        serviceName: typeof candidate.serviceName === 'string' ? candidate.serviceName : candidate.name,
        installed: candidate.installed === true,
        active: candidate.active === true,
        recommended: candidate.recommended === true,
        canInstall: candidate.canInstall === true,
        canUninstall: candidate.canUninstall === true,
      }
    })
    .filter((item): item is FirewallBackendInfo => item !== null)
}

function readFirewallPortUsages(value: unknown): FirewallPortUsage[] {
  if (!Array.isArray(value)) return []

  return value.reduce<FirewallPortUsage[]>((usages, item) => {
    if (!item || typeof item !== 'object') return usages
    const candidate = item as Record<string, unknown>
    const port = candidate.port
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return usages

    usages.push({
      port,
      protocol: 'tcp',
      addonSlug: typeof candidate.addonSlug === 'string' ? candidate.addonSlug : undefined,
      component: typeof candidate.component === 'string' ? candidate.component : 'Unknown component',
      description: typeof candidate.description === 'string' ? candidate.description : '',
      protected: candidate.protected === true,
      severity: candidate.severity === 'critical' || candidate.severity === 'warning' || candidate.severity === 'info'
        ? candidate.severity
        : 'warning',
    })

    return usages
  }, [])
}

function getPortUsageClass(severity: FirewallPortUsage['severity']) {
  if (severity === 'critical') return 'bg-error/10 text-error'
  if (severity === 'warning') return 'bg-warning/10 text-warning'
  return 'bg-grey-50 text-text-secondary'
}

function joinUsageComponents(usages: FirewallPortUsage[]) {
  return Array.from(new Set(usages.map(usage => usage.component))).join(', ')
}

function getClosePortMessageKey(port: number, usages: FirewallPortUsage[]) {
  if (usages.length > 0) return 'addons.closeUsedTcpPortConfirmMsg'
  if (port === 80 || port === 443) return 'addons.closePublicHttpTcpPortConfirmMsg'
  return 'addons.closeTcpPortConfirmMsg'
}

export function AddonManagePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { serverId = '', addonSlug = '' } = useParams()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const canManage = can('servers:connect')
  const [allowedTcpPortRows, setAllowedTcpPortRows] = useState<string[]>(['22'])
  const [newTcpPortInput, setNewTcpPortInput] = useState('')
  const [confirmAction, setConfirmAction] = useState<'install' | 'uninstall' | 'forceUninstall' | 'save' | 'reset' | null>(null)
  const [closePortCandidate, setClosePortCandidate] = useState<number | null>(null)

  const { data: servers = [], isLoading: loadingServers } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
  })

  const { data: availableAddons = [], isLoading: loadingAddons } = useQuery({
    queryKey: ['org-addons', orgId],
    queryFn: () => addonsApi.listOrg(orgId),
    enabled: !!orgId,
  })

  const { data: serverAddonsData, isLoading: loadingInstallations } = useQuery({
    queryKey: ['server-addons', orgId, serverId],
    queryFn: () => addonsApi.listServer(orgId, serverId),
    enabled: !!orgId && !!serverId,
  })

  const server = useMemo(
    () => serverAddonsData?.server ?? servers.find(item => item.id === serverId) ?? null,
    [serverAddonsData?.server, serverId, servers],
  )

  const addon = useMemo(
    () => availableAddons.find(item => item.slug === addonSlug) ?? null,
    [addonSlug, availableAddons],
  )

  const installation = useMemo(
    () => serverAddonsData?.installations.find(item => item.slug === addonSlug) ?? null,
    [addonSlug, serverAddonsData?.installations],
  )
  const protectedSshPort = server?.sshPort ?? 22
  const protectedAgentPort = server?.agentPort ?? 4000
  const parsedFirewallPorts = useMemo(() => parseTcpPortRows(allowedTcpPortRows), [allowedTcpPortRows])

  useEffect(() => {
    const source = (installation?.config ?? {}) as Record<string, unknown>
    setAllowedTcpPortRows(
      Array.from(new Set([...readPortList(source.allowedTcpPorts, [protectedSshPort, protectedAgentPort]), protectedSshPort, protectedAgentPort]))
        .sort((a, b) => a - b)
        .map(String),
    )
    setNewTcpPortInput('')
  }, [installation?.config, installation?.updatedAt, protectedAgentPort, protectedSshPort])

  const install = useMutation({
    mutationFn: () => addonsApi.installOnServer(orgId, serverId, addon!.addOnId),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
      queryClient.invalidateQueries({ queryKey: ['org-addons', orgId] })
    },
  })

  const save = useMutation({
    mutationFn: () => addonsApi.configureServer(
      orgId,
      serverId,
      addon!.addOnId,
      {
        enabled: true,
        allowedTcpPorts: parsedFirewallPorts.ports,
      },
    ),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
    },
  })

  const resetToDefaults = useMutation({
    mutationFn: () => addonsApi.configureServer(orgId, serverId, addon!.addOnId, {
      resetToDefaults: true,
    }),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
    },
  })

  const runAddonAction = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload: Record<string, unknown> }) =>
      addonsApi.runServerAction(orgId, serverId, addon!.addOnId, action, payload),
    onSuccess: () => {
      setClosePortCandidate(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
    },
  })

  const uninstall = useMutation({
    mutationFn: (force: boolean) => addonsApi.uninstallFromServer(orgId, serverId, addon!.addOnId, force),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
    },
  })

  const isLoading = loadingServers || loadingAddons || loadingInstallations

  if (isLoading) {
    return <LoadingState />
  }

  if (!server || !addon) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Wrench}
          title={t('addons.manageNotFoundTitle')}
          subtitle={t('addons.manageNotFoundSubtitle')}
          action={{
            label: t('common.back'),
            onClick: () => navigate('/addons'),
          }}
        />
      </Card>
    )
  }

  const healthEntries = Object.entries((installation?.health ?? {}) as Record<string, unknown>)
    .filter(([key]) => addonSlug !== 'firewall-manager' || ![
      'backends',
      'managedTcpPorts',
      'protectedTcpPorts',
      'openTcpPorts',
      'portUsages',
      'firewallBackend',
      'activeBackend',
      'recommendedBackend',
      'packageManager',
      'rollbackTimeoutSeconds',
    ].includes(key))
  const isInstalled = installation?.status === 'active'
  const isFirewallManager = addon.slug === 'firewall-manager'
  const addonDisplayName = t(`addons.items.${addon.slug}.name`, { defaultValue: addon.name })
  const storedConfig = (installation?.config ?? {}) as Record<string, unknown>
  const storedFirewallPorts = readPortList(storedConfig.allowedTcpPorts, [protectedSshPort, protectedAgentPort])
  const health = (installation?.health ?? {}) as Record<string, unknown>
  const appliedFirewallPorts = readPortList(health.managedTcpPorts, storedFirewallPorts)
  const protectedFirewallPorts = readPortList(health.protectedTcpPorts, [protectedSshPort, protectedAgentPort])
  const openFirewallPorts = readPortList(health.openTcpPorts, [])
  const firewallBackend = typeof health.firewallBackend === 'string' ? health.firewallBackend : null
  const activeFirewallBackend = typeof health.activeBackend === 'string' ? health.activeBackend : null
  const recommendedFirewallBackend = typeof health.recommendedBackend === 'string' ? health.recommendedBackend : null
  const packageManager = typeof health.packageManager === 'string' ? health.packageManager : null
  const firewallBackends = readFirewallBackends(health.backends)
  const firewallPortUsages = readFirewallPortUsages(health.portUsages)
  const firewallPortUsagesByPort = firewallPortUsages.reduce((map, usage) => {
    map.set(usage.port, [...(map.get(usage.port) ?? []), usage])
    return map
  }, new Map<number, FirewallPortUsage[]>())
  const protectedUsagePorts = firewallPortUsages.filter(usage => usage.protected).map(usage => usage.port)
  const protectedPortSet = new Set([...protectedFirewallPorts, ...protectedUsagePorts, protectedSshPort, protectedAgentPort])
  const closePortUsages = closePortCandidate === null ? [] : firewallPortUsagesByPort.get(closePortCandidate) ?? []
  const newTcpPort = parseSingleTcpPort(newTcpPortInput)
  const newTcpPortAlreadyManaged = newTcpPort !== null && parsedFirewallPorts.ports.includes(newTcpPort)
  const addFirewallPort = (port: number) => {
    setAllowedTcpPortRows((current) => {
      if (current.some(row => parseSingleTcpPort(row) === port)) return current
      return [...current, String(port)].sort((a, b) => (parseSingleTcpPort(a) ?? 0) - (parseSingleTcpPort(b) ?? 0))
    })
    setNewTcpPortInput('')
  }
  const updateFirewallPort = (index: number, value: string) => {
    setAllowedTcpPortRows(current => current.map((row, rowIndex) => (rowIndex === index ? value : row)))
  }
  const removeFirewallPort = (index: number) => {
    setAllowedTcpPortRows(current => current.filter((_, rowIndex) => rowIndex !== index))
  }
  const isConfigDirty = isFirewallManager
    ? (
        parsedFirewallPorts.ports.join(',') !== storedFirewallPorts.join(',')
        || storedConfig.enabled === false
      )
    : false
  const currentMutation = (
    confirmAction === 'install' ? install
      : confirmAction === 'uninstall' || confirmAction === 'forceUninstall' ? uninstall
        : confirmAction === 'save' ? save
          : confirmAction === 'reset' ? resetToDefaults
            : null
  )
  const currentError = currentMutation?.error ? getApiError(currentMutation.error, t) : undefined

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={addonDisplayName}
        subtitle={t('addons.manageSubtitle', { server: server.name })}
        action={(
          <Button variant="outline" onClick={() => navigate('/addons')}>
            <ArrowLeft size={14} />
            {t('common.back')}
          </Button>
        )}
      />

      <Card className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Server size={18} strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-sm font-semibold text-text-primary">{server.name}</p>
            <p className="text-xs text-text-secondary">{server.ipAddress}</p>
            <p className="mt-1 text-xs text-text-secondary">
              {t(`servers.status.${server.status}`, { defaultValue: server.status })}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isInstalled ? 'bg-success/10 text-success' : 'bg-grey-50 text-text-secondary'
          }`}>
            {t(`addons.status.${installation?.status ?? 'notInstalled'}`)}
          </span>
          <span className="rounded-full bg-grey-50 px-2 py-0.5 text-[11px] text-text-secondary">
            {t(`addons.categories.${addon.category}`)}
          </span>
          {installation?.version && (
            <span className="rounded-full bg-grey-50 px-2 py-0.5 text-[11px] font-mono text-text-secondary">
              {installation.version}
            </span>
          )}
        </div>

        {!isInstalled ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirmAction('install')} loading={install.isPending} disabled={!canManage}>
              {t('addons.install')}
            </Button>
            {install.error && <p className="text-xs text-destructive">{getApiError(install.error, t)}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmAction('uninstall')}
              loading={uninstall.isPending}
              disabled={!canManage}
            >
              {t('addons.uninstall')}
            </Button>
            {(server.status !== 'online' || uninstall.error) && (
              <Button
                variant="outline"
                className="text-amber-500 hover:text-amber-400"
                onClick={() => setConfirmAction('forceUninstall')}
                loading={uninstall.isPending}
                disabled={!canManage}
              >
                {t('addons.forceRemove')}
              </Button>
            )}
            {uninstall.error && <p className="text-xs text-destructive">{getApiError(uninstall.error, t)}</p>}
          </div>
        )}
      </Card>

      {isInstalled && isFirewallManager && (
        <Card className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Flame size={18} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('addons.firewallConfigTitle')}</p>
              <p className="text-xs text-text-secondary">{t('addons.firewallConfigSubtitle')}</p>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border bg-grey-25/30 p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">{t('addons.firewallBackendsTitle')}</p>
                <p className="text-xs text-text-secondary">{t('addons.firewallBackendsSubtitle')}</p>
              </div>
              <div className="text-xs text-text-secondary">
                {t('addons.packageManager')}: <span className="font-mono text-text-primary">{packageManager ?? '-'}</span>
              </div>
            </div>

            {firewallBackends.length === 0 ? (
              <p className="rounded-xl border border-border bg-background-paper px-4 py-3 text-sm text-text-secondary">
                {t('addons.firewallBackendsEmpty')}
              </p>
            ) : (
              <div className="space-y-2">
                {firewallBackends.map((backend) => {
                  const isBusy = runAddonAction.isPending
                  const activeBackendConflict = activeFirewallBackend !== null && activeFirewallBackend !== backend.name
                  const activationDisabled = !backend.active && activeBackendConflict
                  return (
                    <div key={backend.name} className="flex flex-col gap-3 rounded-xl border border-border bg-background-paper px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-sm font-semibold text-text-primary">{backend.name}</p>
                          {backend.recommended && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                              {t('addons.recommendedBackend')}
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            backend.installed ? 'bg-success/10 text-success' : 'bg-grey-50 text-text-secondary'
                          }`}>
                            {backend.installed ? t('addons.backendInstalled') : t('addons.backendNotInstalled')}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            backend.active ? 'bg-success/10 text-success' : 'bg-grey-50 text-text-secondary'
                          }`}>
                            {backend.active ? t('addons.backendActive') : t('addons.backendInactive')}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-text-secondary">
                          {t('addons.backendPackage')}: <span className="font-mono">{backend.packageName}</span>
                        </p>
                        {activationDisabled && (
                          <p className="mt-2 text-xs text-warning">
                            {t('addons.firewallBackendConflictHint', { backend: activeFirewallBackend })}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {!backend.installed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={backend.canInstall ? 'default' : 'secondary'}
                            onClick={() => runAddonAction.mutate({ action: 'install-backend', payload: { backend: backend.name } })}
                            disabled={!canManage || !backend.canInstall || isBusy}
                          >
                            {t('addons.installBackend')}
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant={backend.active ? 'secondary' : 'default'}
                              onClick={() => runAddonAction.mutate({
                                action: backend.active ? 'deactivate-backend' : 'activate-backend',
                                payload: { backend: backend.name },
                              })}
                              disabled={!canManage || isBusy || activationDisabled}
                              title={activationDisabled ? t('addons.firewallBackendConflictHint', { backend: activeFirewallBackend }) : undefined}
                            >
                              {backend.active ? t('addons.deactivateBackend') : t('addons.activateBackend')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-destructive hover:text-destructive"
                              onClick={() => runAddonAction.mutate({ action: 'uninstall-backend', payload: { backend: backend.name } })}
                              disabled={!canManage || backend.active || !backend.canUninstall || isBusy}
                            >
                              {t('addons.uninstallBackend')}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {!activeFirewallBackend && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-600">
                {t('addons.noActiveFirewallBackend', { backend: recommendedFirewallBackend ?? 'ufw' })}
              </div>
            )}
            {runAddonAction.error && <p className="text-xs text-destructive">{getApiError(runAddonAction.error, t)}</p>}
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('addons.allowedTcpPorts')}</Label>
              <p className="text-xs leading-5 text-text-secondary">{t('addons.allowedTcpPortsHint')}</p>
            </div>

            {allowedTcpPortRows.length === 0 ? (
              <div className="rounded-xl border border-border bg-grey-25/40 px-4 py-3 text-sm text-text-secondary">
                {t('addons.noManagedTcpPorts')}
              </div>
            ) : (
              <div className="space-y-2">
                {allowedTcpPortRows.map((row, index) => {
                  const hasError = parsedFirewallPorts.invalidRows.has(index) || parsedFirewallPorts.duplicateRows.has(index)
                  const port = parseSingleTcpPort(row)
                  const isDuplicateRow = parsedFirewallPorts.duplicateRows.has(index)
                  const isProtectedPort = port !== null && protectedPortSet.has(port)
                  const isLockedProtectedRow = isProtectedPort && !isDuplicateRow
                  return (
                    <div key={index} className="flex flex-col gap-2 rounded-xl border border-border bg-grey-25/30 p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1 sm:max-w-xs">
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={row}
                          onChange={event => updateFirewallPort(index, event.target.value)}
                          disabled={!canManage || isLockedProtectedRow}
                          error={hasError ? 'invalid' : undefined}
                        />
                      </div>
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${isProtectedPort ? 'bg-primary' : 'bg-success'}`} />
                        <p className="text-xs text-text-secondary">
                          {isLockedProtectedRow
                            ? t('addons.sshPortProtected')
                            : isProtectedPort
                              ? t('addons.duplicateProtectedTcpPortRule')
                              : t('addons.managedTcpPortRule')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeFirewallPort(index)}
                        disabled={!canManage || isLockedProtectedRow}
                        aria-label={t('common.remove')}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="number"
                min={1}
                max={65535}
                value={newTcpPortInput}
                onChange={event => setNewTcpPortInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && newTcpPort && !newTcpPortAlreadyManaged) {
                    event.preventDefault()
                    addFirewallPort(newTcpPort)
                  }
                }}
                placeholder={t('addons.addTcpPortPlaceholder')}
                disabled={!canManage}
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 whitespace-nowrap"
                onClick={() => newTcpPort && addFirewallPort(newTcpPort)}
                disabled={!canManage || !newTcpPort || newTcpPortAlreadyManaged}
              >
                <Plus size={14} />
                {t('addons.openTcpPort')}
              </Button>
            </div>

            {parsedFirewallPorts.invalid && (
              <p className="text-xs text-destructive">{t('addons.invalidTcpPorts')}</p>
            )}

            {openFirewallPorts.length > 0 && (
              <div className="rounded-xl border border-border bg-grey-25/40 px-4 py-3">
                <p className="text-xs font-medium text-text-primary">{t('addons.detectedOpenTcpPorts')}</p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">{t('addons.detectedOpenTcpPortsHint')}</p>
                <div className="mt-3 space-y-2">
                  {openFirewallPorts.map((port) => {
                    const isManaged = parsedFirewallPorts.ports.includes(port)
                    const usages = firewallPortUsagesByPort.get(port) ?? []
                    const isProtected = protectedPortSet.has(port) || usages.some(usage => usage.protected)
                    return (
                      <div key={port} className="flex flex-col gap-2 rounded-xl border border-border bg-background-paper px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm text-text-primary">{port}</span>
                            {isManaged && (
                              <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                                {t('addons.managedTcpPortTag')}
                              </span>
                            )}
                            {isProtected && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                                {t('addons.protectedTcpPortTag')}
                              </span>
                            )}
                            {usages.map(usage => (
                              <span key={`${usage.addonSlug ?? 'system'}-${usage.component}`} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${getPortUsageClass(usage.severity)}`}>
                                {usage.component}
                              </span>
                            ))}
                          </div>
                          {usages.length > 0 && (
                            <p className="text-xs leading-5 text-text-secondary">
                              {usages.map(usage => usage.description).filter(Boolean).join(' ')}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!isManaged && (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              className="shrink-0 whitespace-nowrap"
                              onClick={() => addFirewallPort(port)}
                              disabled={!canManage}
                            >
                              <Plus size={13} />
                              {t('addons.openTcpPort')}
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setClosePortCandidate(port)}
                            disabled={!canManage || isProtected || runAddonAction.isPending}
                            title={isProtected ? t('addons.protectedTcpPortCannotClose') : undefined}
                          >
                            <Trash2 size={13} />
                            {t('addons.closeTcpPort')}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-grey-25/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">{t('addons.appliedTcpPorts')}</p>
              <p className="mt-1 font-mono text-sm text-text-primary">{appliedFirewallPorts.join(', ') || '-'}</p>
            </div>
            <div className="rounded-xl border border-border bg-grey-25/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">{t('addons.protectedTcpPorts')}</p>
              <p className="mt-1 font-mono text-sm text-text-primary">{protectedFirewallPorts.join(', ') || '-'}</p>
            </div>
            <div className="rounded-xl border border-border bg-grey-25/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">{t('addons.detectedOpenTcpPorts')}</p>
              <p className="mt-1 font-mono text-sm text-text-primary">{openFirewallPorts.join(', ') || '-'}</p>
            </div>
            <div className="rounded-xl border border-border bg-grey-25/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-secondary">{t('addons.firewallBackend')}</p>
              <p className="mt-1 font-mono text-sm text-text-primary">{firewallBackend ?? '-'}</p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-600">
            {t('addons.firewallSafeUninstallHint')}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmAction('reset')}
              loading={resetToDefaults.isPending}
              disabled={!canManage}
            >
              {t('addons.resetDefaults')}
            </Button>
            <Button
              onClick={() => setConfirmAction('save')}
              loading={save.isPending}
              disabled={!canManage || parsedFirewallPorts.invalid || parsedFirewallPorts.ports.length === 0 || !isConfigDirty}
            >
              {t('common.save')}
            </Button>
          </div>

          {save.error && <p className="text-xs text-destructive">{getApiError(save.error, t)}</p>}
          {resetToDefaults.error && <p className="text-xs text-destructive">{getApiError(resetToDefaults.error, t)}</p>}
        </Card>
      )}

      {isInstalled && (
        <Card className="space-y-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Globe size={18} strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{t('addons.healthTitle')}</p>
              <p className="text-xs text-text-secondary">{t('addons.healthSubtitle')}</p>
            </div>
          </div>

          {healthEntries.length === 0 ? (
            <p className="text-sm text-text-secondary">{t('addons.healthEmpty')}</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {healthEntries.map(([key, value]) => (
                <div key={key} className="rounded-xl border border-grey-100 bg-grey-25/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-wide text-text-secondary">{key}</p>
                  <p className="mt-1 break-all text-sm text-text-primary">{formatHealthValue(value)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={t(
            confirmAction === 'forceUninstall' ? 'addons.forceRemoveConfirmTitle' : `addons.${confirmAction}ConfirmTitle`,
            { addon: t(`addons.items.${addon.slug}.name`, { defaultValue: addon.name }) },
          )}
          message={t(confirmAction === 'forceUninstall' ? 'addons.forceRemoveConfirmMsg' : `addons.${confirmAction}ConfirmMsg`, {
            addon: t(`addons.items.${addon.slug}.name`, { defaultValue: addon.name }),
            server: server.name,
          })}
          confirmLabel={
            confirmAction === 'save'
              ? t('common.save')
              : confirmAction === 'reset'
                ? t('addons.resetDefaults')
                : confirmAction === 'forceUninstall'
                  ? t('addons.forceRemove')
                : t(confirmAction === 'install' ? 'addons.install' : 'addons.uninstall')
          }
          danger={confirmAction === 'uninstall' || confirmAction === 'forceUninstall'}
          loading={Boolean(currentMutation?.isPending)}
          error={currentError}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            if (confirmAction === 'install') install.mutate()
            else if (confirmAction === 'uninstall' || confirmAction === 'forceUninstall') uninstall.mutate(confirmAction === 'forceUninstall')
            else if (confirmAction === 'save') save.mutate()
            else if (confirmAction === 'reset') resetToDefaults.mutate()
          }}
        />
      )}

      {closePortCandidate !== null && (
        <ConfirmDialog
          title={t('addons.closeTcpPortConfirmTitle', { port: closePortCandidate })}
          message={t(
            getClosePortMessageKey(closePortCandidate, closePortUsages),
            { port: closePortCandidate, server: server.name, components: joinUsageComponents(closePortUsages) },
          )}
          confirmLabel={t('addons.closeTcpPort')}
          danger
          loading={runAddonAction.isPending}
          error={runAddonAction.error ? getApiError(runAddonAction.error, t) : undefined}
          onCancel={() => setClosePortCandidate(null)}
          onConfirm={() => runAddonAction.mutate({
            action: 'close-port',
            payload: { port: closePortCandidate },
          })}
        />
      )}
    </div>
  )
}
