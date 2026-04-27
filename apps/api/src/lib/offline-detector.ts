import { lt, eq, and, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { servers, containers } from '../db/schema.js'

const OFFLINE_THRESHOLD_MS = 90_000 // 90 seconds without heartbeat means offline.

/**
 * Detects servers without a recent heartbeat and marks them offline.
 * Also marks containers on those servers as unknown.
 * Runs every 30 seconds.
 */
async function detectOfflineServers() {
  const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS)

  // Servers that were online but have not sent a heartbeat in 90 seconds.
  const staleServers = await db
    .select({ id: servers.id })
    .from(servers)
    .where(
      and(
        eq(servers.status, 'online'),
        isNull(servers.deletedAt),
        lt(servers.lastHeartbeatAt, threshold),
      ),
    )

  if (staleServers.length === 0) return

  const staleIds = staleServers.map(s => s.id)

  // Mark servers as offline.
  await db
    .update(servers)
    .set({ status: 'offline', updatedAt: new Date() })
    .where(inArray(servers.id, staleIds))

  // Mark containers on stale servers as error because their runtime state is unknown.
  await db
    .update(containers)
    .set({ status: 'error', errorReason: 'Server connection lost', updatedAt: new Date() })
    .where(
      and(
        inArray(containers.serverId, staleIds),
        eq(containers.status, 'running'),
      ),
    )

  console.log(`[offline-detector] marked ${staleIds.length} server(s) as offline`)
}

export function startOfflineDetector() {
  // First check 30s after startup.
  setTimeout(() => {
    detectOfflineServers().catch(console.error)
    setInterval(() => detectOfflineServers().catch(console.error), 30_000)
  }, 30_000)
}
