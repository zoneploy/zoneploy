import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth.js'
import type { Server } from '@zoneploy/types'

const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? '/api/v1'

interface MetricsPayload {
  serverId: string
  server: {
    cpuPercent: number
    memoryUsedMb: number
    memoryTotalMb: number
    storageUsedMb: number
    storageTotalMb: number
    cpuCores: number
  }
  containers: Array<{
    containerId: string
    cpuPercent: number
    memoryUsedMb: number
    status: string
  }>
  ts: string
}

/**
 * Subscribes to the organization metrics SSE stream.
 * Actualiza el cache de TanStack Query en tiempo real cada vez que
 * the agent sends a heartbeat (~15s), without additional polling.
 *
 * Reconnects automatically if the server closes the connection.
 */
export function useMetricsStream(orgId: string | undefined) {
  const queryClient = useQueryClient()
  const accessToken = useAuthStore(s => s.accessToken)

  useEffect(() => {
    if (!orgId || !accessToken) return

    const url = `${BASE_URL}/organizations/${orgId}/servers/metrics/stream?token=${encodeURIComponent(accessToken)}`

    let es: EventSource
    let reconnectTimer: ReturnType<typeof setTimeout>
    let stopped = false

    const connect = () => {
      if (stopped) return

      es = new EventSource(url)

      es.onmessage = (event) => {
        let payload: MetricsPayload
        try {
          payload = JSON.parse(event.data) as MetricsPayload
        } catch {
          return
        }

        // Update server metrics in the organization server list.
        queryClient.setQueryData<Server[]>(['servers', orgId], (old) => {
          if (!old) return old
          return old.map(n => {
            if (n.id !== payload.serverId) return n
            return {
              ...n,
              totalMemoryMb: payload.server.memoryTotalMb,
              totalStorageMb: payload.server.storageTotalMb,
              totalCpuCores: payload.server.cpuCores,
            }
          })
        })

        // Update metrics for each container in the organization.
        for (const c of payload.containers) {
          queryClient.setQueryData(
            ['metrics', c.containerId],
            {
              cpuPercent: c.cpuPercent,
              memoryUsedMb: c.memoryUsedMb,
              status: c.status,
              recordedAt: payload.ts,
            },
          )
        }
      }

      es.onerror = () => {
        es.close()
        // Reconectar tras 5s si no fue cerrado intencionalmente
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 5_000)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      clearTimeout(reconnectTimer)
      es?.close()
    }
  }, [orgId, accessToken, queryClient])
}
