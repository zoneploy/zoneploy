import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { containersApi } from '@/api/containers'

export interface ContainerLiveMetrics {
  cpuPercent: number
  memoryUsedMb: number
  // Accumulated since container start from docker stats.
  diskReadMb: number
  diskWriteMb: number
  netRxMb: number
  netTxMb: number
  // Tasas calculadas entre frames consecutivos (~2s)
  diskReadRateMb: number
  diskWriteRateMb: number
  netRxRateMb: number
  netTxRateMb: number
  ts: string
}

/**
 * Connects to the agent SSE stream for live container metrics (~2s).
 * Active only when `enabled` is true, for example while the user is on the Overview tab.
 * Automatically closes the connection on unmount or when `enabled` becomes false.
 */
export function useContainerMetricsLive(
  orgId: string,
  containerId: string,
  enabled: boolean,
): ContainerLiveMetrics | null {
  const accessToken = useAuthStore(s => s.accessToken)
  const [metrics, setMetrics] = useState<ContainerLiveMetrics | null>(null)

  useEffect(() => {
    if (!enabled || !orgId || !containerId || !accessToken) return

    let es: EventSource
    let reconnectTimer: ReturnType<typeof setTimeout>
    let stopped = false

    const connect = () => {
      if (stopped) return

      const url = containersApi.metricsLiveUrl(orgId, containerId, accessToken)
      es = new EventSource(url)

      // Previous frame accumulated values used to calculate rates.
      let prev: Pick<ContainerLiveMetrics, 'diskReadMb' | 'diskWriteMb' | 'netRxMb' | 'netTxMb'> | null = null

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Omit<ContainerLiveMetrics, 'diskReadRateMb' | 'diskWriteRateMb' | 'netRxRateMb' | 'netTxRateMb'>
          if (!('cpuPercent' in data)) return
          const rates = prev
            ? {
                diskReadRateMb: Math.max(0, data.diskReadMb - prev.diskReadMb),
                diskWriteRateMb: Math.max(0, data.diskWriteMb - prev.diskWriteMb),
                netRxRateMb: Math.max(0, data.netRxMb - prev.netRxMb),
                netTxRateMb: Math.max(0, data.netTxMb - prev.netTxMb),
              }
            : { diskReadRateMb: 0, diskWriteRateMb: 0, netRxRateMb: 0, netTxRateMb: 0 }
          prev = data
          setMetrics({ ...data, ...rates })
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
  }, [enabled, orgId, containerId, accessToken])

  return metrics
}
