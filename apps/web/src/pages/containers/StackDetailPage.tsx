import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDistanceToNow, format } from 'date-fns'
import { es, enUS } from 'date-fns/locale'
import { Loader, Play, Square, RefreshCw, Clock, Cpu, MemoryStick, HardDrive, Globe, CheckCircle, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { stacksApi, type StackDeploymentItem } from '@/api/stacks'
import { serversApi } from '@/api/servers'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { useStackServiceMetricsLive } from '@/hooks/useStackServiceMetricsLive'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StackCicdTab } from './StackCicdTab'
import { StackInspectTab } from './StackInspectTab'
import { StackFilesTab } from './StackFilesTab'
import { StackSecretsTab } from './StackSecretsTab'
import { StackDomainsTab } from './StackDomainsTab'
import { StackBackupsTab } from './StackBackupsTab'

type StackServiceView = Awaited<ReturnType<typeof stacksApi.listServices>>[number]
type StackView = Awaited<ReturnType<typeof stacksApi.get>>
const MAX_STACK_LOG_LINES = 500

function StackDeploymentRow({ dep }: { dep: StackDeploymentItem }) {
  const { t, i18n } = useTranslation()
  const dateLocale = i18n.language === 'en' ? enUS : es
  const statusLabel = {
    pending: t('containers.status.deploying'),
    running: t('containers.status.deploying'),
    success: i18n.language === 'en' ? 'Successful' : 'Exitoso',
    failed: i18n.language === 'en' ? 'Failed' : 'Fallido',
  }[dep.status]

  const statusIcon = {
    pending: <Loader size={14} className="text-amber-400 animate-spin" />,
    running: <Loader size={14} className="text-sky-500 animate-spin" />,
    success: <CheckCircle size={14} className="text-emerald-400" />,
    failed: <XCircle size={14} className="text-red-400" />,
  }[dep.status]

  return (
    <div className="flex items-center justify-between gap-3 border-b border-grey-100 py-3 last:border-0">
      <div className="flex min-w-0 items-center gap-3">
        {statusIcon}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{statusLabel}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-text-secondary">
            <Clock size={10} />
            {formatDistanceToNow(new Date(dep.createdAt), { addSuffix: true, locale: dateLocale })}
          </p>
        </div>
      </div>
      {dep.errorMessage ? <p className="max-w-xs truncate text-xs text-red-400">{dep.errorMessage}</p> : null}
    </div>
  )
}
type Tab = 'overview' | 'logs' | 'terminal' | 'secrets' | 'domains' | 'backups' | 'files' | 'inspect' | 'cicd'

function isTab(value: string | null): value is Tab {
  return value === 'overview'
    || value === 'logs'
    || value === 'terminal'
    || value === 'secrets'
    || value === 'domains'
    || value === 'backups'
    || value === 'files'
    || value === 'inspect'
    || value === 'cicd'
}

function formatMb(mb: number): string {
  if (mb < 0.001) return '0 B'
  if (mb < 1) return `${(mb * 1024).toFixed(1)} KB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function StackLogsTab({ orgId, stackId, serviceName }: { orgId: string; stackId: string; serviceName: string }) {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const [lines, setLines] = useState<{ ts: string; message: string }[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!serviceName) return
    setLines([])
    setConnected(false)
    setError(false)
    const token = session?.accessToken
    const controller = new AbortController()

    const connect = async () => {
      try {
        const res = await fetch(stacksApi.logsUrl(orgId, stackId, serviceName), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          setError(true)
          return
        }
        setConnected(true)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data:'))
            if (!dataLine) continue
            try {
              const parsed = JSON.parse(dataLine.slice(5))
              if (parsed.ts && parsed.message) {
                setLines(prev => [...prev.slice(-(MAX_STACK_LOG_LINES - 1)), parsed])
              }
            } catch {}
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setError(true)
      }
    }

    connect()
    return () => controller.abort()
  }, [orgId, stackId, serviceName, session?.accessToken])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  if (!serviceName) {
    return <div className="rounded-xl border border-grey-100 bg-background-paper p-8 text-center text-sm text-text-secondary">{t('stacks.noServices')}</div>
  }

  return (
    <div className="rounded-xl border border-grey-100 bg-background-paper overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-grey-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{t('containers.tabLogs')}</span>
          <span className="text-xs font-mono text-text-secondary">{serviceName}</span>
          {lines.length >= MAX_STACK_LOG_LINES && (
            <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400">
              últimas {MAX_STACK_LOG_LINES} líneas
            </span>
          )}
        </div>
        <span className={`text-xs flex items-center gap-1.5 ${connected ? 'text-emerald-400' : error ? 'text-red-400' : 'text-text-secondary'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : error ? 'bg-red-400' : 'bg-grey-100'}`} />
          {connected ? t('containers.logsLive') : error ? t('containers.logsError') : t('containers.logsConnecting')}
        </span>
      </div>
      <div className="h-96 overflow-y-auto bg-[#0a0f14] p-3 font-mono text-xs text-emerald-300 space-y-0.5">
        {lines.length === 0 && (
          <p className="text-text-secondary">
            {connected ? t('containers.logsEmpty') : error ? t('containers.logsError') : t('containers.logsConnecting')}
          </p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2 leading-5">
            <span className="text-text-secondary shrink-0 select-none">{new Date(line.ts).toLocaleTimeString()}</span>
            <span className="break-all whitespace-pre-wrap">{line.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function StackTerminalTab({ orgId, stackId, serviceName, isRunning }: { orgId: string; stackId: string; serviceName: string; isRunning: boolean }) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!isRunning || !serviceName || !containerRef.current) return

    termRef.current?.dispose()
    wsRef.current?.close()

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'monospace',
      theme: {
        background: '#0a0f14',
        foreground: '#d4d4d4',
        cursor: '#569cd6',
        black: '#3c3c3c',
        green: '#4ec9b0',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        red: '#f44747',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    setTimeout(() => { fit.fit(); term.focus() }, 50)
    termRef.current = term

    const handleResize = () => fit.fit()
    window.addEventListener('resize', handleResize)

    let ws: WebSocket | null = null
    const open = async () => {
      setConnecting(true)
      setError(null)
      try {
        const { accessToken } = useAuthStore.getState()
        ws = new WebSocket(`${stacksApi.terminalWsUrl(orgId, stackId, serviceName)}?token=${encodeURIComponent(accessToken ?? '')}`)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws
        ws.onopen = () => {
          setConnecting(false)
          term.write('\r\n\x1b[32mConectado\x1b[0m\r\n')
          ws!.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
        ws.onmessage = (e) => {
          term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
        }
        ws.onerror = () => { setError(t('containers.terminalError')); setConnecting(false) }
        ws.onclose = () => { term.write('\r\n\x1b[33mDesconectado\x1b[0m\r\n') }
        term.onData((data) => { if (ws?.readyState === WebSocket.OPEN) ws.send(data) })
        term.onResize(({ cols, rows }) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows })) })
      } catch {
        setError(t('containers.terminalError'))
        setConnecting(false)
      }
    }

    open()
    return () => {
      window.removeEventListener('resize', handleResize)
      ws?.close()
      term.dispose()
      termRef.current = null
      wsRef.current = null
    }
  }, [orgId, stackId, serviceName, isRunning, t])

  if (!isRunning) {
    return <div className="rounded-xl border border-grey-100 bg-background-paper p-8 text-center text-sm text-text-secondary">{t('containers.terminalNotRunning')}</div>
  }

  if (!serviceName) {
    return <div className="rounded-xl border border-grey-100 bg-background-paper p-8 text-center text-sm text-text-secondary">{t('stacks.noServices')}</div>
  }

  return (
    <div className="rounded-xl border border-grey-100 bg-[#0a0f14] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-grey-100/20 bg-[#0d141d]">
        <span className="text-xs text-text-secondary font-mono">{serviceName}</span>
        {connecting && <span className="text-xs text-amber-400">{t('containers.terminalConnecting')}</span>}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      <div ref={containerRef} className="p-1" style={{ height: '400px' }} />
    </div>
  )
}

export function StackDetailPage() {
  const { t, i18n } = useTranslation()
  const { stackId } = useParams<{ stackId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const canManage = can('stacks:write')
  const canRuntimeAccess = can('stacks:terminal')
  const queryClient = useQueryClient()
  const [metricsPeriod, setMetricsPeriod] = useState<'1h' | '6h' | '24h'>('1h')
  const dateLocale = i18n.language === 'en' ? enUS : es
  const selectedService = searchParams.get('service') ?? ''
  const rawTab = searchParams.get('tab')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('containers.tabOverview') },
    { id: 'secrets', label: t('containers.tabSecrets') },
    { id: 'domains', label: t('containers.tabDomains') },
    { id: 'backups', label: t('stacks.backups.tab') },
    ...(canRuntimeAccess ? [
      { id: 'logs' as const, label: t('containers.tabLogs') },
      { id: 'terminal' as const, label: t('containers.tabTerminal') },
      { id: 'files' as const, label: t('containers.tabFiles') },
      { id: 'inspect' as const, label: t('containers.tabInspect') },
    ] : []),
    { id: 'cicd', label: t('containers.tabCicd') },
  ]
  const activeTab: Tab = isTab(rawTab) && TABS.some(tab => tab.id === rawTab) ? rawTab : 'overview'

  const { data: stack, isLoading } = useQuery({
    queryKey: ['stacks', orgId, stackId],
    queryFn: () => stacksApi.get(orgId, stackId!),
    enabled: !!stackId && !!orgId,
    refetchInterval: (query) => query.state.data?.status === 'deploying' ? 3000 : false,
  })

  const { data: serversList } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
    staleTime: 60_000,
  })

  const { data: services = [] } = useQuery({
    queryKey: ['stack-services', orgId, stackId],
    queryFn: () => stacksApi.listServices(orgId, stackId!),
    enabled: !!stackId && !!orgId && !!stack?.serverId,
    refetchInterval: stack?.status === 'running' ? 10000 : false,
  })

  const { data: deploymentsData } = useQuery({
    queryKey: ['stack-deployments', orgId, stackId],
    queryFn: () => stacksApi.listDeployments(orgId, stackId!),
    enabled: !!stackId && !!orgId && activeTab === 'overview',
    refetchInterval: stack?.status === 'deploying' ? 3000 : false,
  })

  useEffect(() => {
    if (services.length === 0) return

    const firstService = services[0]!.serviceName
    const hasSelectedService = selectedService && services.some(service => service.serviceName === selectedService)

    if (!hasSelectedService) {
      const params = new URLSearchParams(searchParams)
      params.set('service', firstService)
      if (params.toString() !== searchParams.toString()) {
        setSearchParams(params, { replace: true })
      }
    }
  }, [searchParams, selectedService, services, setSearchParams])

  useEffect(() => {
    if (stack && !stack.hasDeployToken && activeTab !== 'cicd') {
      const params = new URLSearchParams(searchParams)
      params.set('tab', 'cicd')
      setSearchParams(params, { replace: true })
    }
  }, [activeTab, searchParams, setSearchParams, stack])

  const selectedServiceData = useMemo(() => services.find(service => service.serviceName === selectedService) ?? null, [services, selectedService])
  const stackServer = serversList?.find((server) => server.id === stack?.serverId)
  const hostRamTotalMb = stackServer?.totalMemoryMb ?? null

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['stacks', orgId, stackId] })
    queryClient.invalidateQueries({ queryKey: ['stack-services', orgId, stackId] })
    queryClient.invalidateQueries({ queryKey: ['stack-service-metrics-history', orgId, stackId, selectedService] })
  }

  const setOptimisticStackStatus = (status: StackView['status']) => {
    queryClient.setQueryData<StackView>(['stacks', orgId, stackId], current =>
      current ? { ...current, status, updatedAt: new Date().toISOString() } : current,
    )
  }

  const setOptimisticServiceStatus = (serviceName: string, status: StackServiceView['status']) => {
    queryClient.setQueryData<StackServiceView[]>(['stack-services', orgId, stackId], current =>
      current?.map(service =>
        service.serviceName === serviceName
          ? { ...service, status, rawStatus: status }
          : service,
      ) ?? current,
    )
  }

  const startStackMutation = useMutation({
    mutationFn: () => stacksApi.start(orgId, stackId!),
    onMutate: () => setOptimisticStackStatus('running'),
    onSuccess: invalidateAll,
    onSettled: invalidateAll,
  })
  const stopStackMutation = useMutation({
    mutationFn: () => stacksApi.stop(orgId, stackId!),
    onMutate: () => setOptimisticStackStatus('stopped'),
    onSuccess: invalidateAll,
    onSettled: invalidateAll,
  })
  const restartStackMutation = useMutation({
    mutationFn: () => stacksApi.restart(orgId, stackId!),
    onMutate: () => setOptimisticStackStatus('running'),
    onSuccess: invalidateAll,
    onSettled: invalidateAll,
  })
  const redeployStackMutation = useMutation({
    mutationFn: () => stacksApi.deploy(orgId, stackId!, stack?.composeContent ?? ''),
    onMutate: () => setOptimisticStackStatus('deploying'),
    onSuccess: () => {
      invalidateAll()
      queryClient.invalidateQueries({ queryKey: ['stack-deployments', orgId, stackId] })
    },
    onSettled: () => {
      invalidateAll()
      queryClient.invalidateQueries({ queryKey: ['stack-deployments', orgId, stackId] })
    },
  })
  const startServiceMutation = useMutation({
    mutationFn: (serviceName: string) => stacksApi.startService(orgId, stackId!, serviceName),
    onMutate: (serviceName) => setOptimisticServiceStatus(serviceName, 'running'),
    onSuccess: invalidateAll,
    onSettled: invalidateAll,
  })
  const stopServiceMutation = useMutation({
    mutationFn: (serviceName: string) => stacksApi.stopService(orgId, stackId!, serviceName),
    onMutate: (serviceName) => setOptimisticServiceStatus(serviceName, 'stopped'),
    onSuccess: invalidateAll,
    onSettled: invalidateAll,
  })
  const restartServiceMutation = useMutation({
    mutationFn: (serviceName: string) => stacksApi.restartService(orgId, stackId!, serviceName),
    onMutate: (serviceName) => setOptimisticServiceStatus(serviceName, 'restarting'),
    onSuccess: invalidateAll,
    onSettled: invalidateAll,
  })

  const liveMetrics = useStackServiceMetricsLive(
    orgId,
    stackId ?? '',
    selectedService,
    activeTab === 'overview' && !!selectedService && selectedServiceData?.status === 'running',
  )

  const { data: polledMetrics } = useQuery({
    queryKey: ['stack-service-metrics', orgId, stackId, selectedService],
    queryFn: () => stacksApi.currentMetrics(orgId, stackId!, selectedService),
    enabled: !!orgId && !!stackId && !!selectedService && selectedServiceData?.status === 'running' && activeTab !== 'overview',
    refetchInterval: selectedServiceData?.status === 'running' ? 60000 : false,
  })

  const metrics = liveMetrics ?? polledMetrics ?? null

  const { data: metricsHistory = [] } = useQuery({
    queryKey: ['stack-service-metrics-history', orgId, stackId, selectedService, metricsPeriod],
    queryFn: () => stacksApi.metricsHistory(orgId, stackId!, selectedService, metricsPeriod),
    enabled: !!orgId && !!stackId && !!selectedService && selectedServiceData?.status === 'running' && activeTab === 'overview',
    refetchInterval: selectedServiceData?.status === 'running' ? 30000 : false,
  })

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

  const hasIoData = historyWithRates.some(p => p.diskReadRate > 0 || p.diskWriteRate > 0 || p.netRxRate > 0 || p.netTxRate > 0)

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader size={24} className="text-primary animate-spin" /></div>
  }

  if (!stack) return null

  const statusColor: Record<typeof stack.status, string> = {
    created: 'text-text-secondary',
    deploying: 'text-amber-400',
    running: 'text-emerald-400',
    partial: 'text-sky-500',
    stopped: 'text-amber-400',
    error: 'text-red-400',
  }

  return (
    <div className="w-full space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary truncate">{stack.name}</h2>
            <p className={`text-xs font-medium ${statusColor[stack.status]}`}>{t(`stacks.status.${stack.status}`)}</p>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => redeployStackMutation.mutate()}
              loading={redeployStackMutation.isPending}
            >
              <RefreshCw size={13} />
              {t('containers.redeploy')}
            </Button>
            {stack.status === 'stopped' && <Button size="sm" variant="outline" onClick={() => startStackMutation.mutate()} loading={startStackMutation.isPending}><Play size={13} />{t('stacks.start')}</Button>}
            {(stack.status === 'running' || stack.status === 'partial') && <Button size="sm" variant="outline" onClick={() => stopStackMutation.mutate()} loading={stopStackMutation.isPending}><Square size={13} />{t('stacks.stop')}</Button>}
            {(stack.status === 'running' || stack.status === 'partial' || stack.status === 'error') && <Button size="sm" variant="outline" onClick={() => restartStackMutation.mutate()} loading={restartStackMutation.isPending}><RefreshCw size={13} />{t('containers.restart')}</Button>}
          </div>
        )}
      </div>

      {stack.status === 'error' && stack.errorReason && <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-3"><p className="text-sm text-red-400">{stack.errorReason}</p></div>}

      {services.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-grey-100 bg-background-paper">
          <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_140px_220px] gap-4 border-b border-grey-100 bg-grey-25/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
            <span>{t('stacks.serviceView')}</span>
            <span>{t('common.status')}</span>
            <span className="text-right">{t('common.actions')}</span>
          </div>

          <div className="divide-y divide-grey-100">
            {services.map(service => {
              const isSelected = selectedService === service.serviceName

              return (
                <div
                  key={service.serviceName}
                  className={`grid gap-3 px-4 py-3 transition-colors md:grid-cols-[minmax(0,1.3fr)_140px_220px] ${
                    isSelected ? 'bg-primary/5' : 'hover:bg-grey-25/60'
                  }`}
                >
                  <button
                    onClick={() => {
                      const params = new URLSearchParams(searchParams)
                      params.set('service', service.serviceName)
                      setSearchParams(params, { replace: true })
                    }}
                    className="min-w-0 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${
                        service.status === 'running'
                          ? 'bg-emerald-400'
                          : service.status === 'restarting'
                            ? 'bg-amber-400'
                            : service.status === 'stopped'
                              ? 'bg-amber-300'
                              : 'bg-grey-200'
                      }`} />
                      <p className={`truncate text-sm font-semibold ${isSelected ? 'text-primary' : 'text-text-primary'}`}>
                        {service.serviceName}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center md:justify-start">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      service.status === 'running'
                        ? 'bg-emerald-50 text-emerald-500 ring-1 ring-emerald-100'
                        : service.status === 'restarting'
                          ? 'bg-amber-50 text-amber-500 ring-1 ring-amber-100'
                          : service.status === 'stopped'
                            ? 'bg-amber-50 text-amber-500 ring-1 ring-amber-100'
                            : 'bg-grey-50 text-text-secondary ring-1 ring-grey-100'
                    }`}>
                      {service.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap md:justify-end">
                    {canManage && (
                      <>
                        {service.status === 'stopped' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startServiceMutation.mutate(service.serviceName)}
                              loading={startServiceMutation.isPending && startServiceMutation.variables === service.serviceName}
                            >
                            <Play size={13} />
                            {t('stacks.start')}
                          </Button>
                        )}
                        {service.status === 'running' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => stopServiceMutation.mutate(service.serviceName)}
                              loading={stopServiceMutation.isPending && stopServiceMutation.variables === service.serviceName}
                            >
                            <Square size={13} />
                            {t('stacks.stop')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restartServiceMutation.mutate(service.serviceName)}
                          loading={restartServiceMutation.isPending && restartServiceMutation.variables === service.serviceName}
                        >
                          <RefreshCw size={13} />
                          {t('containers.restart')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
          <div className="flex gap-1 border-b border-grey-100 overflow-x-auto overflow-y-hidden">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => {
                  const params = new URLSearchParams(searchParams)
                  params.set('tab', tab.id)
                  setSearchParams(params, { replace: true })
                }}
                className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'overview' && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm">{t('containers.tabOverview')}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-3 text-xs">
                    <div><p className="text-text-secondary mb-0.5">{t('common.status')}</p><p className={`font-medium ${statusColor[stack.status]}`}>{t(`stacks.status.${stack.status}`)}</p></div>
                    <div><p className="text-text-secondary mb-0.5">{t('common.created')}</p><p className="text-text-primary flex items-center gap-1"><Clock size={11} />{formatDistanceToNow(new Date(stack.createdAt), { addSuffix: true, locale: dateLocale })}</p></div>
                  </div>

                  {selectedServiceData ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-text-primary">{selectedServiceData.serviceName}</p>
                      {metrics && 'cpuPercent' in metrics ? (
                        <>
                      <div className="flex items-center gap-2"><Cpu size={14} className="text-text-secondary" /><div className="flex-1"><div className="flex justify-between text-xs text-text-secondary mb-1"><span>CPU</span><span>{metrics.cpuPercent.toFixed(1)}%</span></div><div className="h-1.5 rounded-full bg-grey-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0.5, Math.min(100, metrics.cpuPercent))}%` }} /></div></div></div>
                      <div className="flex items-center gap-2"><MemoryStick size={14} className="text-text-secondary" /><div className="flex-1"><div className="flex justify-between text-xs text-text-secondary mb-1"><span>RAM</span><span className="font-mono tabular-nums">{metrics.memoryUsedMb.toFixed(1)} MB{hostRamTotalMb ? ` / ${(hostRamTotalMb / 1024).toFixed(1)} GB` : ''}</span></div><div className="h-1.5 rounded-full bg-grey-100"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, (metrics.memoryUsedMb / (hostRamTotalMb ?? Math.max(256, metrics.memoryUsedMb * 4))) * 100)}%` }} /></div></div></div>
                      {'diskReadRateMb' in metrics && (
                        <>
                          <div className="flex items-center gap-2 text-xs text-text-secondary"><HardDrive size={14} className="text-text-secondary" /><div className="flex-1 flex justify-between gap-2 min-w-0"><span className="shrink-0">Disk R/W</span><span className="font-mono tabular-nums truncate text-right">{formatMb(metrics.diskReadRateMb)}/s R · {formatMb(metrics.diskWriteRateMb)}/s W</span></div></div>
                          <div className="flex items-center gap-2 text-xs text-text-secondary"><Globe size={14} className="text-text-secondary" /><div className="flex-1 flex justify-between gap-2 min-w-0"><span className="shrink-0">Network</span><span className="font-mono tabular-nums truncate text-right">{formatMb(metrics.netRxRateMb)}/s ↓ · {formatMb(metrics.netTxRateMb)}/s ↑</span></div></div>
                        </>
                      )}
                        </>
                      ) : <p className="text-sm text-text-secondary">{selectedServiceData.status === 'running' ? t('containers.collecting') : t('containers.notRunning')}</p>}
                    </div>
                  ) : <p className="text-sm text-text-secondary">{t('stacks.noServices')}</p>}
                </CardContent>
              </Card>

              {selectedServiceData?.status === 'running' && (
                <Card>
                  <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-sm">{t('containers.metricsHistory')}</CardTitle><div className="flex gap-1">{(['1h', '6h', '24h'] as const).map(period => <button key={period} onClick={() => setMetricsPeriod(period)} className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${metricsPeriod === period ? 'bg-primary text-white' : 'text-text-secondary hover:text-text-primary'}`}>{period}</button>)}</div></div></CardHeader>
                  <CardContent>
                    {metricsHistory.length === 0 ? <p className="text-sm text-text-secondary py-4 text-center">{t('containers.metricsNoData')}</p> : (
                      <div className="grid sm:grid-cols-2 gap-6">
                        <div><div className="flex items-center gap-1.5 mb-2"><Cpu size={13} className="text-text-secondary" /><span className="text-xs text-text-secondary font-medium">CPU %</span></div><ResponsiveContainer width="100%" height={130}><AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="recordedAt" tickFormatter={v => format(new Date(v), 'HH:mm')} tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} width={38} /><Tooltip contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }} labelFormatter={v => format(new Date(v), 'HH:mm:ss')} formatter={(v: number) => [`${v.toFixed(1)}%`, 'CPU']} /><Area type="monotone" dataKey="cpuPercent" stroke="#818cf8" strokeWidth={1.5} fill="#818cf822" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                        <div><div className="flex items-center gap-1.5 mb-2"><MemoryStick size={13} className="text-text-secondary" /><span className="text-xs text-text-secondary font-medium">RAM MB</span></div><ResponsiveContainer width="100%" height={130}><AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="recordedAt" tickFormatter={v => format(new Date(v), 'HH:mm')} tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis domain={[0, 'auto']} tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} width={38} /><Tooltip contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }} labelFormatter={v => format(new Date(v), 'HH:mm:ss')} formatter={(v: number) => [`${v.toFixed(1)} MB`, 'RAM']} /><Area type="monotone" dataKey="memoryUsedMb" stroke="#34d399" strokeWidth={1.5} fill="#34d39922" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                        {hasIoData && (
                          <>
                            <div><div className="flex items-center gap-1.5 mb-2"><HardDrive size={13} className="text-text-secondary" /><span className="text-xs text-text-secondary font-medium">Disco I/O</span></div><ResponsiveContainer width="100%" height={130}><AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="recordedAt" tickFormatter={v => format(new Date(v), 'HH:mm')} tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} width={38} /><Tooltip contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }} labelFormatter={v => format(new Date(v), 'HH:mm:ss')} formatter={(v: number, name: string) => [formatMb(v), name === 'diskReadRate' ? 'Lectura' : 'Escritura']} /><Area type="monotone" dataKey="diskReadRate" stroke="#f59e0b" strokeWidth={1.5} fill="#f59e0b22" dot={false} isAnimationActive={false} /><Area type="monotone" dataKey="diskWriteRate" stroke="#ef4444" strokeWidth={1.5} fill="#ef444422" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                            <div><div className="flex items-center gap-1.5 mb-2"><Globe size={13} className="text-text-secondary" /><span className="text-xs text-text-secondary font-medium">Network I/O</span></div><ResponsiveContainer width="100%" height={130}><AreaChart data={historyWithRates} margin={{ top: 2, right: 4, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" /><XAxis dataKey="recordedAt" tickFormatter={v => format(new Date(v), 'HH:mm')} tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #6b7280)' }} tickLine={false} axisLine={false} width={38} /><Tooltip contentStyle={{ background: 'var(--color-background-paper, #1e293b)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 12 }} labelFormatter={v => format(new Date(v), 'HH:mm:ss')} formatter={(v: number, name: string) => [formatMb(v), name === 'netRxRate' ? 'Recibido' : 'Enviado']} /><Area type="monotone" dataKey="netRxRate" stroke="#06b6d4" strokeWidth={1.5} fill="#06b6d422" dot={false} isAnimationActive={false} /><Area type="monotone" dataKey="netTxRate" stroke="#a78bfa" strokeWidth={1.5} fill="#a78bfa22" dot={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader><CardTitle className="text-sm">{t('containers.deploymentsCard')}</CardTitle></CardHeader>
                <CardContent>
                  {!deploymentsData?.data?.length ? (
                    <p className="text-sm text-text-secondary">{t('containers.noDeployments')}</p>
                  ) : (
                    <div>
                      {deploymentsData.data.map(dep => (
                        <StackDeploymentRow key={dep.id} dep={dep} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'secrets' && <StackSecretsTab orgId={orgId} stackId={stackId!} canManage={canManage} />}
          {activeTab === 'domains' && <StackDomainsTab orgId={orgId} stackId={stackId!} canManage={canManage} />}
          {activeTab === 'backups' && <StackBackupsTab orgId={orgId} stackId={stackId!} canManage={canManage} />}
          {activeTab === 'cicd' && <StackCicdTab orgId={orgId} stackId={stackId!} hasToken={stack.hasDeployToken} />}
          {activeTab === 'logs' && <StackLogsTab orgId={orgId} stackId={stackId!} serviceName={selectedService} />}
          {activeTab === 'terminal' && <StackTerminalTab orgId={orgId} stackId={stackId!} serviceName={selectedService} isRunning={selectedServiceData?.status === 'running'} />}
          {activeTab === 'files' && <StackFilesTab orgId={orgId} stackId={stackId!} serviceName={selectedService} isRunning={selectedServiceData?.status === 'running'} />}
          {activeTab === 'inspect' && <StackInspectTab orgId={orgId} stackId={stackId!} serviceName={selectedService} />}
      </div>
    </div>
  )
}
