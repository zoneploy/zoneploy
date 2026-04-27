import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { containersApi } from '@/api/containers'
import { useAuthStore } from '@/stores/auth'

export function TerminalTab({
  orgId,
  containerId,
  isRunning,
}: {
  orgId: string
  containerId: string
  isRunning: boolean
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    if (!isRunning || !containerRef.current) return

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
    // Esperar a que el DOM tenga dimensiones reales antes de ajustar
    setTimeout(() => { fit.fit(); term.focus() }, 50)

    termRef.current = term
    fitRef.current = fit

    const handleResize = () => fit.fit()
    window.addEventListener('resize', handleResize)

    let ws: WebSocket | null = null

    const open = async () => {
      setConnecting(true)
      setError(null)
      try {
        const { accessToken } = useAuthStore.getState()
        const wsUrl = containersApi.terminalWsUrl(orgId, containerId)
        ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(accessToken ?? '')}`)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => {
          setConnecting(false)
          term.write(`\r\n\x1b[32m${t('containers.terminalConnected')}\x1b[0m\r\n`)
          // Send initial size.
          ws!.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }

        ws.onmessage = (e) => {
          term.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer))
        }

        ws.onerror = () => {
          setError(t('containers.terminalError'))
          setConnecting(false)
        }

        ws.onclose = () => {
          term.write(`\r\n\x1b[33m${t('containers.terminalDisconnected')}\x1b[0m\r\n`)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, containerId, isRunning])

  if (!isRunning) {
    return (
      <div className="rounded-xl border border-grey-100 bg-background-paper p-8 text-center text-sm text-text-secondary">
        {t('containers.terminalNotRunning')}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-grey-100 bg-[#0a0f14] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-grey-100/20 bg-[#0d141d]">
        <span className="text-xs text-text-secondary font-mono">{containerId.slice(0, 8)}</span>
        {connecting && (
          <span className="text-xs text-amber-400">{t('containers.terminalConnecting')}</span>
        )}
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>
      <div ref={containerRef} className="p-1" style={{ height: '400px' }} />
    </div>
  )
}
