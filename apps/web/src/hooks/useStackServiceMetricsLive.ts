import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { stacksApi } from '@/api/stacks'

export interface StackServiceLiveMetrics {
  cpuPercent: number
  memoryUsedMb: number
  diskReadMb: number
  diskWriteMb: number
  netRxMb: number
  netTxMb: number
  diskReadRateMb: number
  diskWriteRateMb: number
  netRxRateMb: number
  netTxRateMb: number
  ts: string
  status: string
}

export function useStackServiceMetricsLive(
  orgId: string,
  stackId: string,
  serviceName: string,
  enabled: boolean,
): StackServiceLiveMetrics | null {
  const accessToken = useAuthStore(s => s.accessToken)
  const [metrics, setMetrics] = useState<StackServiceLiveMetrics | null>(null)

  useEffect(() => {
    if (!enabled || !orgId || !stackId || !serviceName || !accessToken) return

    let es: EventSource
    let reconnectTimer: ReturnType<typeof setTimeout>
    let stopped = false

    const connect = () => {
      if (stopped) return

      const url = stacksApi.metricsLiveUrl(orgId, stackId, serviceName, accessToken)
      es = new EventSource(url)

      let prev: Pick<StackServiceLiveMetrics, 'diskReadMb' | 'diskWriteMb' | 'netRxMb' | 'netTxMb'> | null = null

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Omit<StackServiceLiveMetrics, 'diskReadRateMb' | 'diskWriteRateMb' | 'netRxRateMb' | 'netTxRateMb'>
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
        } catch {
          // Ignorar frames malformados.
        }
      }

      es.addEventListener('error', () => {
        es.close()
        if (!stopped) reconnectTimer = setTimeout(connect, 5_000)
      })
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      es?.close()
      setMetrics(null)
    }
  }, [enabled, orgId, stackId, serviceName, accessToken])

  return metrics
}
