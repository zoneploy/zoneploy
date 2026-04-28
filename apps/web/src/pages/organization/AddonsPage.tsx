import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, Box, Flame, Globe, Layers3, Mail, Network, Package, Server, Shield, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { LoadingState } from '@/components/ui/spinner'
import { addonsApi, type OrgAddon, type ServerAddonInstallation } from '@/api/addons'
import { serversApi, type ServerItem } from '@/api/servers'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { getApiError } from '@/lib/errors'

function addonText(t: (key: string, options?: Record<string, unknown>) => string, addon: Pick<OrgAddon, 'slug' | 'name' | 'description'>) {
  return {
    name: t(`addons.items.${addon.slug}.name`, { defaultValue: addon.name }),
    description: t(`addons.items.${addon.slug}.description`, { defaultValue: addon.description }),
  }
}

function addonCategoryIcon(category: string) {
  switch (category) {
    case 'email':
      return Mail
    case 'networking':
      return Globe
    case 'security':
      return Shield
    case 'observability':
      return Activity
    default:
      return Package
  }
}

function addonIcon(addon: OrgAddon) {
  switch (addon.uiMetadata?.iconKey) {
    case 'globe':
      return Globe
    case 'shield':
      return Shield
    default:
      return addonCategoryIcon(addon.category)
  }
}

function managedComponentIcon(kind: string, name?: string) {
  const normalizedName = name?.toLowerCase() ?? ''
  if (normalizedName.includes('ufw')) return Shield
  if (normalizedName.includes('firewalld')) return Flame
  if (normalizedName.includes('iptables')) return Network

  switch (kind) {
    case 'firewall':
      return Flame
    case 'proxy':
    case 'runtime':
      return Network
    case 'certificate':
      return Shield
    default:
      return Box
  }
}

function evaluateAddonCompatibility(addon: OrgAddon, server: ServerItem | null) {
  if (!server) {
    return {
      compatible: false,
      missingCapabilities: addon.requirements.requiredCapabilities,
      occupiedPorts: addon.requirements.freeTcpPorts,
    }
  }

  const portMap = server.capabilities?.ports ?? {}
  const missingCapabilities = addon.requirements.requiredCapabilities.filter(
    capability => server.capabilities?.[capability as keyof typeof server.capabilities] !== true,
  )
  const occupiedPorts = addon.requirements.freeTcpPorts.filter((port) => portMap[String(port)]?.available === false)

  return {
    compatible: missingCapabilities.length === 0 && occupiedPorts.length === 0,
    missingCapabilities,
    occupiedPorts,
  }
}

function readPortList(value: unknown) {
  if (!Array.isArray(value)) return []

  return Array.from(new Set(value.filter((port): port is number =>
    typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535,
  ))).sort((a, b) => a - b)
}

function getFirewallSummary(installation?: ServerAddonInstallation) {
  if (!installation || installation.slug !== 'firewall-manager') {
    return { managedPorts: [] as number[], openPorts: [] as number[], backend: null as string | null }
  }

  const health = installation.health ?? {}
  const config = installation.config ?? {}
  const healthPorts = readPortList(health.managedTcpPorts)
  const configPorts = readPortList(config.allowedTcpPorts)
  const openPorts = readPortList(health.openTcpPorts)
  const backend = typeof health.firewallBackend === 'string' ? health.firewallBackend : null

  return {
    managedPorts: healthPorts.length > 0 ? healthPorts : configPorts,
    openPorts,
    backend,
  }
}

function AddonCard({
  addon,
  installation,
  server,
  serverId,
  orgId,
  canManage,
  onManage,
}: {
  addon: OrgAddon
  installation?: ServerAddonInstallation
  server: ServerItem | null
  serverId: string
  orgId: string
  canManage: boolean
  onManage?: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const addonCopy = addonText(t, addon)
  const isActive = installation?.status === 'active'
  const statusLabel = installation ? t(`addons.status.${installation.status}`) : t('addons.status.notInstalled')
  const compatibility = evaluateAddonCompatibility(addon, server)
  const [confirmAction, setConfirmAction] = useState<'install' | 'uninstall' | 'forceUninstall' | null>(null)
  const [showBlockedDetails, setShowBlockedDetails] = useState(false)
  const Icon = addonIcon(addon)
  const accentColor = addon.uiMetadata?.accentColor ?? 'var(--color-primary)'
  const managedComponents = addon.managedComponents ?? []
  const firewallSummary = getFirewallSummary(installation)

  const install = useMutation({
    mutationFn: () => addonsApi.installOnServer(orgId, serverId, addon.addOnId),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
    },
  })

  const uninstall = useMutation({
    mutationFn: (force: boolean) => addonsApi.uninstallFromServer(orgId, serverId, addon.addOnId, force),
    onSuccess: () => {
      setConfirmAction(null)
      queryClient.invalidateQueries({ queryKey: ['server-addons', orgId, serverId] })
    },
  })

  const canForceRemove = isActive && (server?.status !== 'online' || Boolean(uninstall.error))
  const canInstall = compatibility.compatible
  const statusDotClass = isActive || canInstall ? 'bg-success' : 'bg-red-500'
  const statusText = isActive
    ? t('addons.installedStandalone')
    : compatibility.compatible
      ? t('addons.readyToInstall')
      : t('addons.installBlockedShort')
  const statusHint = isActive && installation
    ? ''
    : compatibility.compatible
      ? ''
      : ''

  return (
    <div className={`flex h-full flex-col rounded-2xl border p-5 ${isActive ? 'border-primary/35 bg-primary/[0.03]' : 'border-border bg-background-paper'}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex flex-1 items-start gap-3">
          <div
            className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${accentColor}18` }}
          >
            <Icon size={20} style={{ color: accentColor }} strokeWidth={1.7} />
          </div>

          <div className="min-w-0">
            <p className="text-base font-semibold text-text-primary">{addonCopy.name}</p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="rounded-full bg-grey-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {statusLabel}
              </span>
              <span className="rounded-full bg-grey-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                {t(`addons.categories.${addon.category}`)}
              </span>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-text-secondary">
              {addon.uiMetadata?.summary || addonCopy.description}
            </p>
          </div>
        </div>
      </div>

      {managedComponents.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {managedComponents.map(component => {
            const ComponentIcon = managedComponentIcon(component.kind, component.name)
            return (
              <span
                key={`${component.kind}-${component.name}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-grey-25 px-2.5 py-1 text-xs text-text-secondary"
              >
                <ComponentIcon size={11} />
                {component.name}
              </span>
            )
          })}
        </div>
      )}

      {!isActive && !compatibility.compatible ? (
        <button
          type="button"
          onClick={() => setShowBlockedDetails(true)}
          className="mt-5 w-full rounded-2xl border border-border bg-grey-25 px-4 py-3 text-left transition-colors hover:border-red-500/30 hover:bg-red-500/[0.03]"
        >
          <div className="flex items-start gap-3">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{statusText}</p>
              {statusHint && (
                <p className="mt-1 text-xs leading-5 text-text-secondary">{statusHint}</p>
              )}
            </div>
          </div>
        </button>
      ) : (
        <div className="mt-5 w-full rounded-2xl border border-border bg-grey-25 px-4 py-3 text-left">
          <div className="flex items-start gap-3">
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{statusText}</p>
              {statusHint && (
                <p className="mt-1 text-xs leading-5 text-text-secondary">{statusHint}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {installation && installation.bindingCount > 0 && (
        <div className="mt-4 flex items-center gap-3 text-xs text-text-secondary">
          <span>{t('addons.bindingCount', { count: installation.bindingCount })}</span>
        </div>
      )}

      {isActive && installation?.slug === 'firewall-manager' && (
        <div className="mt-4 rounded-2xl border border-border bg-background-paper/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
              <span>
                {t('addons.managedTcpPorts')}: <strong className="font-mono text-text-primary">{firewallSummary.managedPorts.join(', ') || '-'}</strong>
              </span>
              <span>
                {t('addons.detectedOpenTcpPorts')}: <strong className="font-mono text-text-primary">{firewallSummary.openPorts.join(', ') || '-'}</strong>
              </span>
              {firewallSummary.backend && (
              <span>
                {t('addons.firewallBackend')}: <strong className="font-mono text-text-primary">{firewallSummary.backend}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-auto pt-5">
        {canManage && (
          <div className="border-t border-border pt-4">
            {isActive ? (
              <div className="flex items-center gap-2">
                {onManage && (
                  <Button
                    className="flex-1"
                    variant="default"
                    onClick={onManage}
                  >
                    {t('addons.manage')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  className="rounded-md px-3"
                  onClick={() => setConfirmAction('uninstall')}
                  loading={uninstall.isPending}
                  aria-label={t('addons.uninstall')}
                  title={t('addons.uninstall')}
                >
                  {t('addons.uninstall')}
                </Button>
                {canForceRemove && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-amber-500 hover:text-amber-400"
                    onClick={() => setConfirmAction('forceUninstall')}
                    loading={uninstall.isPending}
                  >
                    {t('addons.forceRemove')}
                  </Button>
                )}
              </div>
            ) : (
              <Button
                className="w-full"
                variant={canInstall ? 'default' : 'secondary'}
                onClick={() => setConfirmAction('install')}
                loading={install.isPending}
                disabled={!canInstall}
              >
                {t('addons.install')}
              </Button>
            )}
          </div>
        )}
      </div>

      {(install.error || uninstall.error) && (
        <p className="mt-3 text-xs text-destructive">
          {getApiError(install.error ?? uninstall.error, t)}
        </p>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={t(confirmAction === 'forceUninstall' ? 'addons.forceRemoveConfirmTitle' : `addons.${confirmAction}ConfirmTitle`, { addon: addonCopy.name })}
          message={t(confirmAction === 'forceUninstall' ? 'addons.forceRemoveConfirmMsg' : `addons.${confirmAction}ConfirmMsg`, {
            addon: addonCopy.name,
            server: server?.name ?? '',
          })}
          confirmLabel={t(
            confirmAction === 'install'
              ? 'addons.install'
              : confirmAction === 'forceUninstall'
                ? 'addons.forceRemove'
                : 'addons.uninstall',
          )}
          danger={confirmAction === 'uninstall' || confirmAction === 'forceUninstall'}
          loading={confirmAction === 'install' ? install.isPending : uninstall.isPending}
          error={
            confirmAction === 'install'
              ? (install.error ? getApiError(install.error, t) : undefined)
              : (uninstall.error ? getApiError(uninstall.error, t) : undefined)
          }
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            if (confirmAction === 'install') install.mutate()
            else uninstall.mutate(confirmAction === 'forceUninstall')
          }}
        />
      )}

      <Dialog
        open={showBlockedDetails}
        onClose={() => setShowBlockedDetails(false)}
        title={t('addons.blockedDetailsTitle', { addon: addonCopy.name })}
        description={t('addons.blockedDetailsSubtitle', { server: server?.name ?? '' })}
      >
        <div className="space-y-4">
          {compatibility.missingCapabilities.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text-primary">{t('addons.missingCapabilitiesTitle')}</p>
              <ul className="space-y-2 text-sm text-text-secondary">
                {compatibility.missingCapabilities.map(capability => (
                  <li key={capability} className="rounded-lg border border-border bg-grey-25 px-3 py-2">
                    {t(`addons.serverCapabilities.${capability}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {compatibility.occupiedPorts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-text-primary">{t('addons.occupiedPortsTitle')}</p>
              <ul className="space-y-2 text-sm text-text-secondary">
                {compatibility.occupiedPorts.map(port => (
                  <li key={port} className="rounded-lg border border-border bg-grey-25 px-3 py-2">
                    {t('addons.serverPortRequirement', { port })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  )
}

export function AddonsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const canManage = can('servers:connect')

  const { data: availableAddons = [], isLoading: loadingAddons } = useQuery({
    queryKey: ['org-addons', orgId],
    queryFn: () => addonsApi.listOrg(orgId),
    enabled: !!orgId,
  })

  const { data: servers = [], isLoading: loadingServers } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
  })

  const requestedServerId = searchParams.get('serverId') ?? ''
  const selectedServerId = useMemo(() => {
    if (requestedServerId && servers.some(server => server.id === requestedServerId)) {
      return requestedServerId
    }

    return servers[0]?.id ?? ''
  }, [requestedServerId, servers])

  const selectedServer = useMemo(
    () => servers.find(server => server.id === selectedServerId) ?? null,
    [selectedServerId, servers],
  )

  const { data: serverAddonsData } = useQuery({
    queryKey: ['server-addons', orgId, selectedServerId],
    queryFn: () => addonsApi.listServer(orgId, selectedServerId),
    enabled: !!orgId && !!selectedServerId,
  })

  const effectiveServer = serverAddonsData?.server?.id === selectedServerId
    ? serverAddonsData.server
    : selectedServer
  const installationRows = serverAddonsData?.server?.id === selectedServerId
    ? serverAddonsData.installations
    : []

  const installationMap = useMemo(
    () => new Map(installationRows.map(installation => [installation.addOnId, installation])),
    [installationRows],
  )
  const isLoading = loadingAddons || loadingServers

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('addons.title')}
        subtitle={t('addons.pageSubtitle')}
      />

      {isLoading ? (
        <LoadingState />
      ) : servers.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Server}
            title={t('addons.noServersTitle')}
            subtitle={t('addons.noServersSubtitle')}
          />
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Layers3 size={18} className="text-primary" strokeWidth={1.6} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{t('addons.serverInstallationsTitle')}</p>
                  <p className="text-xs text-text-secondary">{t('addons.serverInstallationsSubtitle')}</p>
                </div>
              </div>

              <div className="w-full max-w-sm space-y-1.5">
                <p className="text-xs font-medium text-text-secondary">{t('addons.serverFilterLabel')}</p>
                <Select
                  value={selectedServerId}
                  onChange={(event) => {
                    if (event.target.value === selectedServerId) return

                    const nextParams = new URLSearchParams(searchParams)
                    nextParams.set('serverId', event.target.value)
                    setSearchParams(nextParams, { replace: true })
                  }}
                >
                  {servers.map(server => (
                    <option key={server.id} value={server.id}>
                      {server.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

          </Card>

          {availableAddons.length === 0 ? (
            <Card className="p-6">
              <EmptyState icon={Sparkles} title={t('addons.empty')} />
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {availableAddons.map(addon => (
                <AddonCard
                  key={addon.addOnId}
                  addon={addon}
                  installation={installationMap.get(addon.addOnId)}
                  server={effectiveServer}
                  serverId={selectedServerId}
                  orgId={orgId}
                  canManage={canManage}
                  onManage={
                    selectedServerId
                      ? () => navigate(`/addons/${selectedServerId}/${addon.slug}`)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
