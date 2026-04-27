import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { containersApi } from '@/api/containers'
import { useAuthStore } from '@/stores/auth'

const MAX_LINES = 500

interface LogLine {
  ts: string
  message: string
}

export function LogsTab({ orgId, containerId }: { orgId: string; containerId: string }) {
  const { t } = useTranslation()
  const session = useAuthStore(s => s.session)
  const [lines, setLines] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    setLines([])
    setConnected(false)
    setError(false)

    const token = session?.accessToken
    // EventSource does not support headers, so use fetch streaming.
    const url = containersApi.logsUrl(orgId, containerId)
    const controller = new AbortController()

    const connect = async () => {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) { setError(true); return }

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
            if (part.startsWith('data: ')) {
              try {
                const entry = JSON.parse(part.slice(6)) as LogLine
                setLines(prev => [...prev.slice(-(MAX_LINES - 1)), entry])
              } catch { /* ignorar */ }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setError(true)
      }
    }

    connect()

    return () => {
      controller.abort()
      esRef.current?.close()
    }
  }, [orgId, containerId, session?.accessToken])

  // Auto-scroll to the latest log.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="rounded-xl border border-grey-100 bg-background-paper overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-grey-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">{t('containers.tabLogs')}</span>
          {lines.length >= MAX_LINES && (
            <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              últimas {MAX_LINES} líneas
            </span>
          )}
        </div>
        <span className={`text-xs flex items-center gap-1.5 ${connected ? 'text-emerald-400' : error ? 'text-red-400' : 'text-text-secondary'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : error ? 'bg-red-400' : 'bg-grey-100'}`} />
          {connected ? t('containers.logsLive') : error ? t('containers.logsError') : t('containers.logsConnecting')}
        </span>
      </div>

      <div className="h-96 overflow-y-auto bg-[#0a0f14] p-3 font-mono text-xs text-emerald-300 space-y-0.5">
        {lines.length === 0 ? (
          <p className="text-text-secondary">{connected ? t('containers.logsEmpty') : error ? t('containers.logsError') : t('containers.logsConnecting')}</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-text-secondary shrink-0 select-none">
                {new Date(line.ts).toLocaleTimeString()}
              </span>
              <span className="break-all whitespace-pre-wrap">{line.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
