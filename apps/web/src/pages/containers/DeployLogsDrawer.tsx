import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, CheckCircle, XCircle, Loader } from 'lucide-react'
import { containersApi } from '@/api/containers'
import { useAuthStore } from '@/stores/auth'
import { tryRefreshToken } from '@/lib/api-client'

interface LogEntry {
  message: string
  level: 'info' | 'warn' | 'error'
  ts: string
  done?: boolean
  params?: Record<string, string>
}

interface DeployLogsDrawerProps {
  orgId: string
  containerId: string
  deploymentId: string
  deploymentStatus: 'pending' | 'running' | 'success' | 'failed'
  onClose: () => void
}

export function DeployLogsDrawer({
  orgId,
  containerId,
  deploymentId,
  deploymentStatus,
  onClose,
}: DeployLogsDrawerProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [finished, setFinished] = useState(deploymentStatus === 'success' || deploymentStatus === 'failed')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const url = containersApi.deployLogsUrl(orgId, containerId, deploymentId)
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
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            if (part.startsWith('event: done')) {
              setFinished(true)
            } else if (part.startsWith('data: ')) {
              try {
                const entry = JSON.parse(part.slice(6)) as LogEntry
                setEntries(prev => [...prev, entry])
                if (entry.done) setFinished(true)
              } catch { /* ignorar */ }
            }
          }
        }
      } catch {
        // ignorar
      }
    }

    connect()
    return () => controller.abort()
  }, [orgId, containerId, deploymentId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  const levelColor = (level: string) => {
    if (level === 'error') return 'text-red-400'
    if (level === 'warn') return 'text-amber-400'
    return 'text-emerald-300'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-background rounded-xl border border-grey-100 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-grey-100">
          <div className="flex items-center gap-2">
            {finished
              ? deploymentStatus === 'failed'
                ? <XCircle size={14} className="text-red-400" />
                : <CheckCircle size={14} className="text-emerald-400" />
              : <Loader size={14} className="text-blue-400 animate-spin" />
            }
            <span className="text-sm font-medium text-text-primary">{t('containers.deployLogs')}</span>
            <span className="font-mono text-xs text-text-secondary">{deploymentId.slice(0, 8)}</span>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={16} />
          </button>
        </div>

        {/* Logs */}
        <div className="h-72 overflow-y-auto bg-[#0a0f14] p-3 font-mono text-xs space-y-0.5">
          {entries.length === 0 ? (
            <p className="text-text-secondary">{t('containers.deployLogsEmpty')}</p>
          ) : (
            entries.map((e, i) => (
              <div key={i} className={`flex gap-2 leading-5 ${levelColor(e.level)}`}>
                <span className="text-text-secondary shrink-0 select-none">
                  {new Date(e.ts).toLocaleTimeString()}
                </span>
                <span className="break-all whitespace-pre-wrap">{t(e.message, { ...e.params, defaultValue: e.message })}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  )
}
