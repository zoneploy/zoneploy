import { useEffect, useRef, useState } from 'react'
import AnsiToHtml from 'ansi-to-html'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Cpu,
  HardDrive,
  Loader,
  MemoryStick,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTranslation } from 'react-i18next'
import { LoadingState } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { ServerStatusBadge } from '@/components/shared/ServerStatusBadge'
import { PageHeader } from '@/components/shared/PageHeader'
import { serversApi, type AgentAuditReport, type AgentAuditStatus, type ServerDockerCleanupResult, type ServerItem } from '@/api/servers'
import { useAuthStore } from '@/stores/auth'
import { usePermissions } from '@/hooks/usePermissions'
import { tryRefreshToken } from '@/lib/api-client'
import { useMetricsStream } from '@/hooks/useMetricsStream'
import { useServerMetricsLive } from '@/hooks/useServerMetricsLive'
import { getApiError } from '@/lib/errors'

const ansiConverter = new AnsiToHtml({ escapeXML: true, newline: true })

interface ProvisionLogEntry {
  type: 'step' | 'line'
  ok: boolean
  step?: string
  message?: string
  stream?: 'stdout' | 'stderr'
  error?: string
  ts: string
}

function ProvisionLogStream({
  orgId,
  serverId,
}: {
  orgId: string
  serverId: string
}) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<ProvisionLogEntry[]>([])
  const [done, setDone] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const url = serversApi.provisionLogsUrl(orgId, serverId)
    const controller = new AbortController()

    const connect = async () => {
      try {
        let token = useAuthStore.getState().accessToken
        let res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (res.status === 401) {
          token = await tryRefreshToken()
          if (!token) return
          res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          })
        }

        if (!res.ok || !res.body) return

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            if (part.startsWith('event: done')) {
              setDone(true)
              return
            }
            if (!part.startsWith('data: ')) continue
            try {
              const entry = JSON.parse(part.slice(6)) as ProvisionLogEntry
              setEntries(prev => [...prev, entry])
            } catch {
              // Ignore malformed SSE chunks.
            }
          }
        }
        setDone(true)
      } catch {
        // Ignore transient stream failures.
      }
    }

    connect()
    return () => controller.abort()
  }, [orgId, serverId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  return (
    <div className="h-64 overflow-y-auto rounded-lg bg-[#0a0f14] p-3 space-y-1.5">
      {entries.length === 0 ? (
        <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
          <Loader size={12} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      ) : (
        entries.map((entry, index) => (
          <div key={index} className="flex items-start gap-2 text-xs font-mono">
            <ScrollText
              size={12}
              className={`${entry.stream === 'stderr' ? 'text-amber-400' : 'text-sky-300'} mt-0.5 shrink-0`}
            />
            <span
              className={`whitespace-pre-wrap break-all ${entry.stream === 'stderr' ? 'text-amber-300' : 'text-slate-200'}`}
              dangerouslySetInnerHTML={{ __html: ansiConverter.toHtml(entry.message ?? entry.step ?? entry.error ?? '') }}
            />
          </div>
        ))
      )}
      {!done && entries.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-mono text-amber-400">
          <Loader size={10} className="animate-spin" />
          <span>{t('servers.provisioning')}</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

function ServerTerminal({
  orgId,
  server,
  onClose,
}: {
  orgId: string
  server: ServerItem
  onClose: () => void
}) {
  const { t } = useTranslation()
  const termRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!termRef.current) return

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
    term.open(termRef.current)
    fit.fit()
    term.focus()

    const handleResize = () => fit.fit()
    window.addEventListener('resize', handleResize)

    let ws: WebSocket | null = null

    const open = async () => {
      try {
        const { accessToken } = useAuthStore.getState()
        const wsUrl = serversApi.terminalWsUrl(orgId, server.id)
        ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(accessToken ?? '')}&cols=${term.cols}&rows=${term.rows}`)
        ws.binaryType = 'arraybuffer'

        ws.onopen = () => {
          setStatus('connected')
          term.write(`\r\n\x1b[32mConnected to ${server.name} (${server.ipAddress})\x1b[0m\r\n\r\n`)
          ws!.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
        ws.onmessage = (event) => {
          term.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer))
        }
        ws.onerror = () => {
          setError(t('servers.terminalError'))
          setStatus('error')
        }
        ws.onclose = () => {
          term.write('\r\n\x1b[33mDisconnected\x1b[0m\r\n')
        }
        term.onData((data) => {
          if (ws?.readyState === WebSocket.OPEN) ws.send(data)
        })
        term.onResize(({ cols, rows }) => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols, rows }))
          }
        })
      } catch {
        setError(t('servers.terminalError'))
        setStatus('error')
      }
    }

    open()

    return () => {
      window.removeEventListener('resize', handleResize)
      ws?.close()
      term.dispose()
    }
  }, [orgId, server.id, server.ipAddress, server.name, t])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0f14]">
      <div className="flex items-center justify-between border-b border-grey-100/20 bg-[#0d141d] px-4 py-3">
        <div className="flex items-center gap-2">
          <TerminalSquare size={14} className="text-text-secondary" />
          <span className="text-sm font-mono text-text-primary">{t('servers.terminalTitle', { name: server.name })}</span>
          <span className="text-xs font-mono text-text-secondary">{server.ipAddress}</span>
        </div>
        <div className="flex items-center gap-3">
          {status === 'connecting' && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <Loader size={11} className="animate-spin" />
              {t('servers.terminalConnecting')}
            </span>
          )}
          {error && <span className="text-xs text-red-400">{error}</span>}
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={16} />
          </button>
        </div>
      </div>
      <div
        ref={termRef}
        className="flex-1 p-2"
        onClick={() => termRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()}
      />
    </div>
  )
}

const auditStatusClass: Record<AgentAuditStatus, string> = {
  pass: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  warn: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
  fail: 'border-red-500/20 bg-red-500/10 text-red-400',
  info: 'border-sky-500/20 bg-sky-500/10 text-sky-400',
}

function AuditStatusPill({ status }: { status: AgentAuditStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${auditStatusClass[status]}`}>
      {status}
    </span>
  )
}

function AgentAuditSummary({ report }: { report: AgentAuditReport }) {
  const summary: Array<{ status: AgentAuditStatus; value: number }> = [
    { status: 'pass', value: report.summary.pass },
    { status: 'warn', value: report.summary.warn },
    { status: 'fail', value: report.summary.fail },
    { status: 'info', value: report.summary.info },
  ]

  return (
    <div className="grid grid-cols-4 gap-2">
      {summary.map(item => (
        <div key={item.status} className={`rounded-lg border px-3 py-2 ${auditStatusClass[item.status]}`}>
          <p className="text-lg font-semibold leading-none">{item.value}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">{item.status}</p>
        </div>
      ))}
    </div>
  )
}

function AgentAuditModal({
  orgId,
  server,
  onClose,
}: {
  orgId: string
  server: ServerItem
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['servers', orgId, server.id, 'agent-audit'],
    queryFn: () => serversApi.audit(orgId, server.id),
  })

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('servers.audit.title')}
      description={t('servers.audit.subtitle', { name: server.name })}
      className="max-w-3xl"
    >
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <div className="space-y-4">
          <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {getApiError(error, t)}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
            <Button onClick={() => refetch()} loading={isFetching}>
              <RefreshCw size={14} />
              {t('servers.audit.retry')}
            </Button>
          </div>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-grey-100 bg-grey-25 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-text-primary">{data.hostname}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  {t('servers.audit.meta', {
                    version: data.agentVersion,
                    os: data.os.distroId ?? data.os.platform,
                    generatedAt: new Date(data.generatedAt).toLocaleString(),
                  })}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>
                <RefreshCw size={13} />
                {t('servers.audit.refresh')}
              </Button>
            </div>
            <div className="mt-4">
              <AgentAuditSummary report={data} />
            </div>
          </div>

          <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1">
            {data.sections.map(section => (
              <div key={section.title} className="rounded-xl border border-grey-100 bg-background-paper p-4">
                <h4 className="text-sm font-semibold text-text-primary">{section.title}</h4>
                <div className="mt-3 space-y-2">
                  {section.checks.map(check => (
                    <div key={check.id} className="flex items-start justify-between gap-3 rounded-lg bg-grey-25 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary">{check.title}</p>
                        <p className="mt-0.5 text-xs text-text-secondary">{check.message}</p>
                      </div>
                      <AuditStatusPill status={check.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

function formatCleanupSize(mb: number) {
  if (mb <= 0) return '0 MB'
  if (mb < 1) return `${Math.round(mb * 1024)} KB`
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function DockerCleanupResultView({ result }: { result: ServerDockerCleanupResult }) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-grey-100 bg-grey-25 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{t('servers.cleanup.reclaimed')}</p>
        <p className="mt-1 text-2xl font-semibold text-text-primary">{formatCleanupSize(result.totalReclaimedMb)}</p>
      </div>

      <div className="space-y-2">
        {result.commands.map(command => (
          <div key={command.label} className="rounded-lg border border-grey-100 bg-background-paper px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-text-primary">
                {t(`servers.cleanup.labels.${command.label}`, { defaultValue: command.label })}
              </p>
              <span className="shrink-0 rounded-full bg-grey-50 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                {formatCleanupSize(command.reclaimedMb)}
              </span>
            </div>
            <p className="mt-1 truncate font-mono text-[11px] text-text-secondary">
              {command.command} {command.args.join(' ')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DockerCleanupModal({
  orgId,
  server,
  onClose,
}: {
  orgId: string
  server: ServerItem
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [olderThanHours, setOlderThanHours] = useState(24)
  const [result, setResult] = useState<ServerDockerCleanupResult | null>(null)
  const [hasDryRun, setHasDryRun] = useState(false)

  const cleanup = useMutation({
    mutationFn: (dryRun: boolean) =>
      serversApi.dockerCleanup(orgId, server.id, {
        dryRun,
        olderThanHours,
        pruneStoppedContainers: true,
        pruneDanglingImages: true,
        pruneBuildCache: true,
        pruneUnusedNetworks: true,
      }),
    onSuccess: (data) => {
      setResult(data)
      if (data.dryRun) setHasDryRun(true)
    },
  })

  useEffect(() => {
    setHasDryRun(false)
    setResult(null)
  }, [olderThanHours])

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('servers.cleanup.title')}
      description={t('servers.cleanup.subtitle', { name: server.name })}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
          {t('servers.cleanup.safeNote')}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>{t('servers.cleanup.olderThan')}</Label>
            <Select
              value={String(olderThanHours)}
              onChange={(event) => setOlderThanHours(Number(event.target.value))}
              disabled={cleanup.isPending}
            >
              <option value="24">{t('servers.cleanup.hours', { count: 24 })}</option>
              <option value="48">{t('servers.cleanup.hours', { count: 48 })}</option>
              <option value="168">{t('servers.cleanup.days', { count: 7 })}</option>
              <option value="720">{t('servers.cleanup.days', { count: 30 })}</option>
            </Select>
          </div>
          <Button variant="secondary" onClick={() => cleanup.mutate(true)} loading={cleanup.isPending && cleanup.variables === true}>
            <RefreshCw size={13} />
            {t('servers.cleanup.dryRun')}
          </Button>
          <Button
            onClick={() => cleanup.mutate(false)}
            loading={cleanup.isPending && cleanup.variables === false}
            disabled={!hasDryRun}
          >
            <HardDrive size={13} />
            {t('servers.cleanup.run')}
          </Button>
        </div>

        {cleanup.error && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
            {getApiError(cleanup.error, t)}
          </p>
        )}

        {!result ? (
          <p className="rounded-xl border border-grey-100 bg-grey-25 px-4 py-6 text-center text-sm text-text-secondary">
            {t('servers.cleanup.empty')}
          </p>
        ) : (
          <DockerCleanupResultView result={result} />
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Dialog>
  )
}

function MetricBar({
  used,
  total,
  label,
  isPercent,
}: {
  used: number | null
  total: number | null
  label: string
  isPercent?: boolean
}) {
  if (used == null || !total) return null
  const pct = isPercent ? Math.min(100, used) : Math.min(100, (used / total) * 100)
  const color = pct > 85 ? 'bg-red-500' : pct > 65 ? 'bg-amber-500' : 'bg-emerald-500'
  const valueLabel = isPercent ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-text-secondary">
        <span>{label}</span>
        <span className="tabular-nums">{valueLabel}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-grey-100">
        <div className={`h-full rounded-full transition-[width] duration-700 ease-in-out ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function ServerCard({
  server,
  orgId,
  canManage,
  canOpenTerminal,
}: {
  server: ServerItem
  orgId: string
  canManage: boolean
  canOpenTerminal: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const liveMetrics = useServerMetricsLive(orgId, server.id, server.status === 'online')
  const [showProvisionLogs, setShowProvisionLogs] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [showCleanup, setShowCleanup] = useState(false)

  useQuery({
    queryKey: ['servers', orgId, server.id],
    queryFn: async () => {
      try {
        const updated = await serversApi.get(orgId, server.id)
        if (updated.status !== 'provisioning') {
          queryClient.invalidateQueries({ queryKey: ['servers', orgId] })
        }
        return updated
      } catch {
        queryClient.invalidateQueries({ queryKey: ['servers', orgId] })
        return null
      }
    },
    enabled: server.status === 'provisioning',
    refetchInterval: 3000,
  })

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-grey-100 bg-background-paper">
        <div className="flex items-start justify-between border-b border-grey-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-lg bg-grey-50 p-2 shrink-0">
              <Server size={16} className="text-text-secondary" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary">{server.name}</span>
                <ServerStatusBadge status={server.status} />
              </div>
              <p className="mt-0.5 font-mono text-xs text-text-secondary">{server.ipAddress}</p>
              {server.agentVersion && (
                <p className="mt-0.5 text-[10px] text-text-secondary/60">
                  {t('servers.agentVersion', { version: server.agentVersion })}
                </p>
              )}
            </div>
          </div>

          <div className="ml-2 flex shrink-0 items-center gap-1">
            {canOpenTerminal && server.status === 'online' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowTerminal(true)}
                className="text-text-secondary hover:text-primary"
                title={t('servers.terminal')}
              >
                <TerminalSquare size={14} />
              </Button>
            )}
            {server.status === 'online' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowAudit(true)}
                className="text-text-secondary hover:text-primary"
                title={t('servers.audit.action')}
              >
                <ShieldCheck size={14} />
              </Button>
            )}
            {canManage && server.status === 'online' && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCleanup(true)}
                className="text-text-secondary hover:text-warning"
                title={t('servers.cleanup.action')}
              >
                <HardDrive size={14} />
              </Button>
            )}
          </div>
        </div>

        {(server.totalCpuCores || server.totalMemoryMb || server.totalStorageMb) && (
          <div className="flex items-center gap-4 border-b border-grey-100 bg-grey-25 px-4 py-2 text-xs text-text-secondary">
            {server.totalCpuCores && (
              <span className="flex items-center gap-1.5">
                <Cpu size={11} />
                {server.totalCpuCores} {t('common.cores')}
              </span>
            )}
            {server.totalMemoryMb && (
              <span className="flex items-center gap-1.5">
                <MemoryStick size={11} />
                {Math.round(server.totalMemoryMb / 1024)} GB RAM
              </span>
            )}
            {server.totalStorageMb && (
              <span className="flex items-center gap-1.5">
                <HardDrive size={11} />
                {Math.round(server.totalStorageMb / 1024)} GB
              </span>
            )}
          </div>
        )}

        <div className="space-y-3 px-4 py-3">
          <div className="rounded-lg border border-grey-100 bg-grey-25 px-3 py-2 text-xs text-text-secondary">
            <span className="font-medium text-text-primary">{t('servers.manualUpdateTitle')}</span>
            <span className="ml-1">{t('servers.manualUpdateHint')}</span>
            <code className="ml-2 rounded bg-background-paper px-1.5 py-0.5 font-mono text-[11px] text-text-primary">zoneploy-agent update</code>
          </div>

          {server.status === 'online' && liveMetrics && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                live
              </div>
              <MetricBar used={liveMetrics.server.cpuPercent} total={100} label="CPU" isPercent />
              <MetricBar used={liveMetrics.server.memoryUsedMb} total={liveMetrics.server.memoryTotalMb} label="RAM" />
              <MetricBar used={liveMetrics.server.storageUsedMb} total={liveMetrics.server.storageTotalMb} label="Disk" />
            </div>
          )}

          {server.status === 'provisioning' && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              {t('servers.provisioning')}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-grey-100 px-4 py-2">
          <button
            onClick={() => setShowProvisionLogs(true)}
            className="flex items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <ScrollText size={11} />
            {t('servers.viewProvisionLogs')}
          </button>
        </div>
      </div>

      {showProvisionLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowProvisionLogs(false)}>
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-grey-100 bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-grey-100 px-4 py-3">
              <span className="text-sm font-medium text-text-primary">{t('servers.provisionLogsTitle')}</span>
              <button onClick={() => setShowProvisionLogs(false)} className="text-text-secondary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="p-4">
              <ProvisionLogStream orgId={orgId} serverId={server.id} />
            </div>
          </div>
        </div>
      )}

      {showTerminal && (
        <ServerTerminal orgId={orgId} server={server} onClose={() => setShowTerminal(false)} />
      )}

      {showAudit && (
        <AgentAuditModal orgId={orgId} server={server} onClose={() => setShowAudit(false)} />
      )}

      {showCleanup && (
        <DockerCleanupModal orgId={orgId} server={server} onClose={() => setShowCleanup(false)} />
      )}
    </>
  )
}

export function ServersPage() {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const orgId = session?.org?.id ?? ''
  const { can } = usePermissions()
  const canManage = can('servers:connect')
  const canOpenTerminal = can('servers:terminal')

  useMetricsStream(orgId)

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['servers', orgId],
    queryFn: () => serversApi.list(orgId),
    enabled: !!orgId,
    refetchInterval: 60_000,
  })

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t('servers.title')}
        subtitle={t('servers.count', { count: servers.length })}
      />

      {isLoading ? (
        <LoadingState />
      ) : servers.length === 0 ? (
        <Card>
          <EmptyState
            icon={Server}
            title={t('servers.empty')}
            subtitle={t('servers.emptySubtitle')}
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {servers.map(server => (
            <ServerCard
              key={server.id}
              server={server}
              orgId={orgId}
              canManage={canManage}
              canOpenTerminal={canOpenTerminal}
            />
          ))}
        </div>
      )}
    </div>
  )
}
