import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { orgMembers, users } from '../../db/schema.js'
import { REDIS_KEYS, redis } from '../../lib/redis.js'
import { createNotification } from '../notifications/notifications.service.js'

export const LOW_DISK_WARNING_THRESHOLD_PERCENT = 85
export const LOW_DISK_WARNING_TTL_SECONDS = 6 * 60 * 60

export interface ServerDiskMetrics {
  storageUsedMb: number
  storageTotalMb: number
}

export interface ServerDiskWarningInput extends ServerDiskMetrics {
  orgId: string
  serverId: string
  serverName: string
}

export function calculateDiskUsedPercent(metrics: ServerDiskMetrics): number | null {
  if (!Number.isFinite(metrics.storageUsedMb) || !Number.isFinite(metrics.storageTotalMb)) return null
  if (metrics.storageTotalMb <= 0 || metrics.storageUsedMb < 0) return null
  return Math.max(0, Math.round((metrics.storageUsedMb / metrics.storageTotalMb) * 100))
}

export function shouldCreateServerDiskWarning(
  metrics: ServerDiskMetrics,
  thresholdPercent = LOW_DISK_WARNING_THRESHOLD_PERCENT,
): boolean {
  const usedPercent = calculateDiskUsedPercent(metrics)
  return usedPercent !== null && usedPercent >= thresholdPercent
}

export function buildServerDiskWarningData(input: ServerDiskWarningInput) {
  const usedPercent = calculateDiskUsedPercent(input) ?? 0
  return {
    serverName: input.serverName,
    usedPercent,
    storageUsedGb: Math.round((input.storageUsedMb / 1024) * 10) / 10,
    storageTotalGb: Math.round((input.storageTotalMb / 1024) * 10) / 10,
  }
}

export async function maybeCreateServerDiskWarning(input: ServerDiskWarningInput): Promise<boolean> {
  const alertKey = REDIS_KEYS.serverDiskWarning(input.serverId)

  if (!shouldCreateServerDiskWarning(input)) {
    await redis.del(alertKey).catch(() => null)
    return false
  }

  const claimed = await redis
    .set(alertKey, '1', 'NX', 'EX', LOW_DISK_WARNING_TTL_SECONDS)
    .catch((error: unknown) => {
      console.error('[server-disk-alerts] Failed to claim alert throttle window:', error)
      return null
    })

  if (claimed !== 'OK') return false

  const recipients = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(
      eq(orgMembers.orgId, input.orgId),
      inArray(orgMembers.role, ['owner', 'admin']),
      eq(users.status, 'active'),
    ))
    .catch((error) => {
      console.error('[server-disk-alerts] Failed to load notification recipients:', error)
      return []
    })

  await Promise.all(
    recipients.map(recipient =>
      createNotification({
        userId: recipient.userId,
        orgId: input.orgId,
        type: 'server_disk_warning',
        data: buildServerDiskWarningData(input),
        link: '/servers',
      }),
    ),
  ).catch((error) => {
    console.error('[server-disk-alerts] Failed to create notifications:', error)
  })

  return recipients.length > 0
}
