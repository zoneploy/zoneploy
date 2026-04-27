import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink,
  Cpu, MemoryStick, Clock, CheckCircle, XCircle, Loader, AlertTriangle, ScrollText,
  Play, Square, RefreshCw, HardDrive, Globe,
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTranslation } from 'react-i18next'
import { containersApi, type ContainerItem, type DeploymentItem } from '@/api/containers'
import { serversApi } from '@/api/servers'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { useMetricsStream } from '@/hooks/useMetricsStream'
import { useContainerMetricsLive } from '@/hooks/useContainerMetricsLive'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ContainerStatusBadge } from '@/components/shared/ContainerStatusBadge'
import { SecretsTab } from './SecretsTab'
import { DomainsTab } from './DomainsTab'
import { LogsTab } from './LogsTab'
import { TerminalTab } from './TerminalTab'
import { DeployLogsDrawer } from './DeployLogsDrawer'
import { CicdTab } from './CicdTab'
import { InspectTab } from './InspectTab'
import { FilesTab } from './FilesTab'

// Tabs

type Tab = 'overview' | 'secrets' | 'domains' | 'logs' | 'terminal' | 'cicd' | 'inspect' | 'files'

// Deployment row

function DeploymentRow({
  dep,
  orgId,
  containerId,
  isCurrent,
}: {
  dep: DeploymentItem
  orgId: string
  containerId: string
  isCurrent: boolean
}) {
  const { t, i18n } = useTranslation()
  const [showLogs, setShowLogs] = useState(false)
  const dateLocale = i18n.language === 'en' ? enUS : es

  const StatusIcon = {
    pending: <Loader size={14} className="text-amber-400 animate-spin" />,
    running: <Loader size={14} className="text-blue-400 animate-spin" />,
    success: <CheckCircle size={14} className="text-emerald-400" />,
    failed: <XCircle size={14} className="text-red-400" />,
  }[dep.status]

  return (
    <>
      <div className={`flex items-center justify-between py-3 border-b border-grey-100 last:border-0 gap-3 ${isCurrent ? 'opacity-100' : 'opacity-70'}`}>
        <div className="flex items-center gap-3 min-w-0">
          {StatusIcon}
          <div className="min-w-0">
            <p className="text-sm text-text-primary font-mono truncate" title={dep.imageSnapshot}>
              {formatImage(dep.imageSnapshot)}
            </p>
            <p className="text-xs text-text-secondary mt-0.5 flex items-center gap-1">
              <Clock size={10} />
              {formatDistanceToNow(new Date(dep.createdAt), { addSuffix: true, locale: dateLocale })}
              {isCurrent && <span className="ml-1 text-primary">({t('common.current')})</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {dep.status === 'failed' && dep.errorMessage && (
            <p className="text-xs text-red-400 truncate max-w-xs">{dep.errorMessage}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs(true)}
            className="text-text-secondary hover:text-text-primary"
          >
            <ScrollText size={12} />
            {t('containers.viewLogs')}
          </Button>
        </div>
      </div>

      {showLogs && (
        <DeployLogsDrawer
          orgId={orgId}
          containerId={containerId}
          deploymentId={dep.id}
          deploymentStatus={dep.status}
          onClose={() => setShowLogs(false)}
        />
      )}
    </>
  )
}

// Helpers

/** registry.host/org/name:tag -> registry.host/tag */
function formatImage(image: string | null): string {
  if (!image) return '—'
  const hostMatch = image.match(/^([^/]+)\//)
  const tagMatch = image.match(/:([^:]+)$/)
  if (hostMatch && tagMatch) return `${hostMatch[1]}/${tagMatch[1]}`
  return image
}

function formatMb(mb: number): string {
  if (mb < 0.001) return '0 B'
  if (mb < 1) return `${(mb * 1024).toFixed(1)} KB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}


// Detail page

export function ContainerDetailPage() {
  const { t } = useTranslation()
  const { containerId } = useParams<{ containerId: string }>()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const canManage = can('containers:write')
  const canRuntimeAccess = can('containers:terminal')
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [metricsPeriod, setMetricsPeriod] = useState<'1h' | '6h' | '24h'>('1h')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('containers.tabOverview') },
    { id: 'secrets', label: t('containers.tabSecrets') },
    { id: 'domains', label: t('containers.tabDomains') },
    ...(canRuntimeAccess ? [
      { id: 'logs' as const, label: t('containers.tabLogs') },
      { id: 'terminal' as const, label: t('containers.tabTerminal') },
      { id: 'files' as const, label: t('containers.tabFiles') },
      { id: 'inspect' as const, label: t('containers.tabInspect') },
    ] : []),
    { id: 'cicd', label: t('containers.tabCicd') },
  ]

  useEffect(() => {
    if (!TABS.some(tab => tab.id === activeTab)) {
      setActiveTab('overview')
    }
  }, [activeTab, TABS])

  // SSE updates metrics cache in real time (heartbeat ~15s).
  useMetricsStream(orgId)

  const { data: container, isLoading } = useQuery({
    queryKey: ['containers', orgId, containerId],
    queryFn: () => containersApi.get(orgId, containerId!),
    enabled: !!containerId && !!orgId,
    refetchInterval: (query) => query.state.data?.status === 'deploying' ? 3000 : false,
  })

  // Container server, used to get totalMemoryMb as the RAM bar ceiling.
  const { data: serversList } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
  })
  const containerServer = serversList?.find(s => s.id === container?.serverId)
  const serverRamTotalMb = containerServer?.totalMemoryMb ?? null

  useEffect(() => {
    if (container?.status === 'waiting') setActiveTab('cicd')
  }, [container?.status])

  const { data: deploymentsData } = useQuery({
    queryKey: ['deployments', orgId, containerId],
    queryFn: () => containersApi.listDeployments(orgId, containerId!),
    enabled: !!containerId && !!orgId,
  })

  // Live metrics from the agent (~2s), active only on the overview tab.
  const liveMetrics = useContainerMetricsLive(
    orgId,
    containerId ?? '',
    activeTab === 'overview' && container?.status === 'running',
  )

  // Fallback polling when the stream is unavailable on other tabs.
  const { data: polledMetrics } = useQuery({
    queryKey: ['metrics', containerId],
    queryFn: () => containersApi.currentMetrics(orgId, containerId!),
    enabled: container?.status === 'running' && activeTab !== 'overview',
    refetchInterval: container?.status === 'running' ? 60_000 : false,
  })

  const metrics = liveMetrics ?? polledMetrics

  const { data: metricsHistory = [] } = useQuery({
    queryKey: ['metrics-history', containerId, metricsPeriod],
    queryFn: () => containersApi.metricsHistory(orgId, containerId!, metricsPeriod),
    enabled: !!containerId && !!orgId && container?.status === 'running' && activeTab === 'overview',
    refetchInterval: container?.status === 'running' ? 30_000 : false,
  })

  // For disk and network, calculate interval rate from consecutive point deltas.
  const historyWithRates = metricsHistory.map((point, i) => {
    const prev = metricsHistory[i - 1]
    return {
      ...point,
      diskReadRate: prev ? Math.max(0, point.diskReadMb - prev.diskReadMb) : 0,
      diskWriteRate: prev ? Math.max(0, point.diskWriteMb - prev.diskWriteMb) : 0,
      netRxRate: prev ? Math.max(0, point.netRxMb - prev.netRxMb) : 0,
      netTxRate: prev ? Math.max(0, point.netTxMb - prev.netTxMb) : 0,
    }
  })

  const invalidateContainer = () =>
    queryClient.invalidateQueries({ queryKey: ['containers', orgId, containerId] })

  const start = useMutation({
    mutationFn: () => containersApi.start(orgId, containerId!),
    onSuccess: invalidateContainer,
  })

  const stop = useMutation({
    mutationFn: () => containersApi.stop(orgId, containerId!),
    onSuccess: invalidateContainer,
  })

  const restart = useMutation({
    mutationFn: () => containersApi.restart(orgId, containerId!),
    onSuccess: invalidateContainer,
  })

  const redeploy = useMutation({
    mutationFn: () => containersApi.deploy(orgId, containerId!),
    onMutate: () => {
      queryClient.setQueryData(['containers', orgId, containerId], (current: ContainerItem | undefined) =>
        current ? { ...current, status: 'deploying', needsRedeploy: false } : current,
      )
    },
    onSuccess: () => {
      invalidateContainer()
      queryClient.invalidateQueries({ queryKey: ['deployments', orgId, containerId] })
    },
    onSettled: () => {
      invalidateContainer()
      queryClient.invalidateQueries({ queryKey: ['deployments', orgId, containerId] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader size={24} className="text-primary animate-spin" />
      </div>
    )
  }

  if (!container) return null

  const publicHost = container.domain?.hostname
  const url = publicHost ? `https://${publicHost}` : null

  return (
    <div className="w-full space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary">{container.name}</h2>
            <ContainerStatusBadge status={container.status} />
          </div>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
              <ExternalLink size={10} />
              {publicHost}
            </a>
          )}
        </div>
        {canManage && container.dockerId && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => redeploy.mutate()}
              loading={redeploy.isPending}
              title={t('containers.redeploy')}
            >
              <RefreshCw size={13} />
              {t('containers.redeploy')}
            </Button>
            {container.status === 'stopped' && (
              <Button
                size="sm" variant="outline"
                onClick={() => start.mutate()}
                loading={start.isPending}
                title={t('containers.start')}
              >
                <Play size={13} />
                {t('containers.start')}
              </Button>
            )}
            {container.status === 'running' && (
              <Button
                size="sm" variant="outline"
                onClick={() => stop.mutate()}
                loading={stop.isPending}
                title={t('containers.stop')}
              >
                <Square size={13} />
                {t('containers.stop')}
              </Button>
            )}
            {(container.status === 'running' || container.status === 'error') && (
              <Button
                size="sm" variant="outline"
                onClick={() => restart.mutate()}
                loading={restart.isPending}
                title={t('containers.restart')}
              >
                <RefreshCw size={13} />
                {t('containers.restart')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Secrets changed; redeploy is pending. */}
      {container.needsRedeploy && (
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-4 py-3 text-sm text-amber-400 flex items-center gap-2">
          <AlertTriangle size={14} className="shrink-0" />
          {t('containers.needsRedeployBanner')}
        </div>
      )}

      {/* Error */}
      {container.status === 'error' && container.errorReason && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          {t('containers.errorReason', { reason: container.errorReason })}
        </div>
      )}

      {/* Tab nav */}
      <div className="flex border-b border-grey-100 gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Config */}
            <Card>
              <CardHeader>
                <CardTitle>{t('containers.configCard')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {[
                    [t('containers.configImage'), formatImage(container.image)],
                    [t('containers.configPort'), `:${container.port}`],
                    container.serverName ? [t('containers.configServer'), container.serverName] : null,
                    (container.projectName && container.environmentName)
                      ? [t('containers.configEnvironment'), `${container.projectName} / ${container.environmentName}`]
                      : null,
                  ].filter((x): x is [string, string] => x !== null).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2 min-w-0">
                      <dt className="text-text-secondary shrink-0">{k}</dt>
                      <dd className="text-text-primary font-mono text-xs truncate text-right">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            {/* Current metrics. */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t('containers.metricsCard')}</CardTitle>
                  {liveMetrics && (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      live
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {metrics && 'cpuPercent' in metrics ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Cpu size={14} className="text-text-secondary" />
                      <div className="flex-1">
                        <div className="flex justify-between text-xs text-text-secondary mb-1">
                          <span>CPU</span>
                          <span>{metrics.cpuPercent.toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-grey-100">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-in-out"
                            style={{ width: `${Math.max(0.5, Math.min(100, metrics.cpuPercent))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <MemoryStick size={14} className="text-text-secondary" />
                      <div className="flex-1">
                        <div className="flex justify-between text-xs text-text-secondary mb-1">
                          <span>RAM</span>
                          <span className="font-mono tabular-nums">
                            {metrics.memoryUsedMb.toFixed(1)} MB
                            {serverRamTotalMb ? ` / ${(serverRamTotalMb / 1024).toFixed(1)} GB` : ''}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-grey-100">
                          <div
                            className="h-full rounded-full bg-emerald-400 transition-[width] duration-700 ease-in-out"
                            style={{ width: `${Math.min(100, (metrics.memoryUsedMb / (serverRamTotalMb ?? Math.max(256, metrics.memoryUsedMb * 4))) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    {'diskReadRateMb' in metrics && (
                      <>
                        <div className="flex items-center gap-2">
                          <HardDrive size={14} className="text-text-secondary" />
                          <div className="flex-1 flex justify-between gap-2 min-w-0 text-xs text-text-secondary">
                            <span className="shrink-0">Disk R/W</span>
                            <span className="font-mono tabular-nums truncate text-right">{formatMb(metrics.diskReadRateMb)}/s R · {formatMb(metrics.diskWriteRateMb)}/s W</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Globe size={14} className="text-text-secondary" />
                          <div className="flex-1 flex justify-between gap-2 min-w-0 text-xs text-text-secondary">
                            <span className="shrink-0">Network</span>
                            <span className="font-mono tabular-nums truncate text-right">{formatMb(metrics.netRxRateMb)}/s ↓ · {formatMb(metrics.netTxRateMb)}/s ↑</span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-text-secondary">
                    {container.status === 'running'
                      ? t('containers.collecting')
                      : t('containers.notRunning')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Historical metrics charts. */}
          {container.status === 'running' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t('containers.metricsHistory')}</CardTitle>
                  <div className="flex gap-1">
                    {(['1h', '6h', '24h'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setMetricsPeriod(p)}
                        className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                          metricsPeriod === p
                            ? 'bg-primary text-white'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {metricsHistory.length === 0 ? (
                  <p className="text-sm text-text-secondary py-4 text-center">{t('containers.metricsNoData')}</p>
                ) : (
                  <div className="grid sm:grid-cols-2 gap-6">
                    {/* CPU */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <Cpu size={13} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary font-medium">CPU %</span>
                      </div>
                      <ResponsiveContainer width="100%" height={130}>
                        <AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#818cf8" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="recordedAt"
                            tickFormatter={v => format(new Date(v), 'HH:mm')}
                            tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            domain={[0, 100]}
                            tickFormatter={v => `${v}%`}
                            tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                            tickLine={false}
                            axisLine={false}
                            width={38}
                          />
                          <Tooltip
                            contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
                            labelFormatter={v => format(new Date(v), 'HH:mm:ss')}
                            formatter={(v: number) => [`${v.toFixed(1)}%`, 'CPU']}
                          />
                          <Area type="monotone" dataKey="cpuPercent" stroke="#818cf8" strokeWidth={1.5} fill="url(#cpuGrad)" dot={false} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Memory */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <MemoryStick size={13} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary font-medium">RAM MB</span>
                      </div>
                      <ResponsiveContainer width="100%" height={130}>
                        <AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#34d399" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis
                            dataKey="recordedAt"
                            tickFormatter={v => format(new Date(v), 'HH:mm')}
                            tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                            tickLine={false}
                            axisLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            domain={[0, 'auto']}
                            tickFormatter={v => `${v}`}
                            tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                            tickLine={false}
                            axisLine={false}
                            width={38}
                          />
                          <Tooltip
                            contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
                            labelFormatter={v => format(new Date(v), 'HH:mm:ss')}
                            formatter={(v: number) => [`${v.toFixed(1)} MB`, 'RAM']}
                          />
                          <Area type="monotone" dataKey="memoryUsedMb" stroke="#34d399" strokeWidth={1.5} fill="url(#memGrad)" dot={false} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Disco I/O */}
                    {
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <HardDrive size={13} className="text-text-secondary" />
                          <span className="text-xs text-text-secondary font-medium">Disco I/O <span className="opacity-50">(MB/min)</span></span>
                        </div>
                        <ResponsiveContainer width="100%" height={130}>
                          <AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="diskReadGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="diskWriteGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis
                              dataKey="recordedAt"
                              tickFormatter={v => format(new Date(v), 'HH:mm')}
                              tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tickFormatter={v => `${v}`}
                              tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                              tickLine={false}
                              axisLine={false}
                              width={38}
                            />
                            <Tooltip
                              contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
                              labelFormatter={v => format(new Date(v), 'HH:mm:ss')}
                              formatter={(v: number, name: string) => [formatMb(v), name === 'diskReadRate' ? 'Lectura' : 'Escritura']}
                            />
                            <Area type="monotone" dataKey="diskReadRate" stroke="#f59e0b" strokeWidth={1.5} fill="url(#diskReadGrad)" dot={false} isAnimationActive={false} />
                            <Area type="monotone" dataKey="diskWriteRate" stroke="#ef4444" strokeWidth={1.5} fill="url(#diskWriteGrad)" dot={false} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    }

                    {/* Network I/O */}
                    {
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <Globe size={13} className="text-text-secondary" />
                          <span className="text-xs text-text-secondary font-medium">Network I/O <span className="opacity-50">(MB/min)</span></span>
                        </div>
                        <ResponsiveContainer width="100%" height={130}>
                          <AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="netRxGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="netTxGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis
                              dataKey="recordedAt"
                              tickFormatter={v => format(new Date(v), 'HH:mm')}
                              tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tickFormatter={v => `${v}`}
                              tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }}
                              tickLine={false}
                              axisLine={false}
                              width={38}
                            />
                            <Tooltip
                              contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }}
                              labelFormatter={v => format(new Date(v), 'HH:mm:ss')}
                              formatter={(v: number, name: string) => [formatMb(v), name === 'netRxRate' ? 'Recibido ↓' : 'Enviado ↑']}
                            />
                            <Area type="monotone" dataKey="netRxRate" stroke="#06b6d4" strokeWidth={1.5} fill="url(#netRxGrad)" dot={false} isAnimationActive={false} />
                            <Area type="monotone" dataKey="netTxRate" stroke="#a78bfa" strokeWidth={1.5} fill="url(#netTxGrad)" dot={false} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    }
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Historial de deployments */}
          <Card>
            <CardHeader>
              <CardTitle>{t('containers.deploymentsCard')}</CardTitle>
            </CardHeader>
            <CardContent>
              {!deploymentsData?.data?.length ? (
                <p className="text-sm text-text-secondary">{t('containers.noDeployments')}</p>
              ) : (
                <div>
                  {deploymentsData.data.map(dep => (
                    <DeploymentRow
                      key={dep.id}
                      dep={dep}
                      orgId={orgId}
                      containerId={container.id}
                      isCurrent={dep.id === container.currentDeploymentId}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'secrets' && (
        <SecretsTab
          orgId={orgId}
          containerId={container.id}
          canManage={canManage}
        />
      )}

      {activeTab === 'domains' && (
        <DomainsTab
          orgId={orgId}
          containerId={container.id}
          canManage={canManage}
          needsRedeploy={container.needsRedeploy}
        />
      )}


      {activeTab === 'logs' && (
        <LogsTab
          orgId={orgId}
          containerId={container.id}
        />
      )}

      {activeTab === 'terminal' && (
        <TerminalTab
          orgId={orgId}
          containerId={container.id}
          isRunning={container.status === 'running'}
        />
      )}

      {activeTab === 'files' && (
        <FilesTab
          orgId={orgId}
          containerId={container.id}
          isRunning={container.status === 'running'}
        />
      )}

      {activeTab === 'inspect' && (
        <InspectTab
          orgId={orgId}
          containerId={container.id}
        />
      )}

      {activeTab === 'cicd' && (
        <CicdTab
          orgId={orgId}
          containerId={container.id}
          hasToken={container.hasDeployToken}
        />
      )}
    </div>
  )
}
