import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'

const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? '/api/v1'

export interface ServerLiveMetrics {
  server: {
    cpuPercent: number
    memoryUsedMb: number
    memoryTotalMb: number
    storageUsedMb: number
    storageTotalMb: number
    cpuCores: number
  }
  containers: Array<{
    dockerId: string
    name: string
    status: string
    cpuPercent: number
    memoryUsedMb: number
  }>
  ts: string
}

/**
 * Connects to the agent SSE stream for live VPS metrics (~2s).
 * Active only when `enabled` is true.
 */
export function useServerMetricsLive(
  orgId: string,
  serverId: string,
  enabled: boolean,
): ServerLiveMetrics | null {
  const accessToken = useAuthStore(s => s.accessToken)
  const [metrics, setMetrics] = useState<ServerLiveMetrics | null>(null)

  useEffect(() => {
    if (!enabled || !orgId || !serverId || !accessToken) return

    let es: EventSource
    let reconnectTimer: ReturnType<typeof setTimeout>
    let stopped = false

    const connect = () => {
      if (stopped) return

      const url = `${BASE_URL}/organizations/${orgId}/servers/${serverId}/metrics/live?token=${encodeURIComponent(accessToken)}`
      es = new EventSource(url)

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as ServerLiveMetrics
          if (data.server) setMetrics(data)
        } catch { /* ignorar frames malformados */ }
      }

      es.addEventListener('error', () => {
        es.close()
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 5_000)
        }
      })
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      es?.close()
      setMetrics(null)
    }
  }, [enabled, orgId, serverId, accessToken])

  return metrics
}
