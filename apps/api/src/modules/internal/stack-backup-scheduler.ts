import type { FastifyBaseLogger } from 'fastify'
import { and, eq, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { orgMembers, stackBackupPolicies, stacks, users } from '../../db/schema.js'
import { REDIS_KEYS, redis } from '../../lib/redis.js'
import { createNotification } from '../notifications/notifications.service.js'
import { calculateNextStackBackupRun, createStackBackup } from '../stacks/stacks.service.js'

const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000
const POLICY_LOCK_TTL_SECONDS = 20 * 60
const MAX_POLICIES_PER_TICK = 20

export async function notifyStackBackupFailed(input: {
  orgId: string
  stackId: string
  stackName: string
  errorMessage: string
}) {
  const recipients = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .where(and(
      eq(orgMembers.orgId, input.orgId),
      inArray(orgMembers.role, ['owner', 'admin']),
      eq(users.status, 'active'),
    ))

  await Promise.all(
    recipients.map(recipient =>
      createNotification({
        userId: recipient.userId,
        orgId: input.orgId,
        type: 'stack_backup_failed',
        data: {
          stackName: input.stackName,
          error: input.errorMessage,
        },
        link: `/stacks/${input.stackId}?tab=backups`,
      }),
    ),
  )
}

export async function runDueStackBackups(now = new Date(), log?: Pick<FastifyBaseLogger, 'warn' | 'info'>) {
  const duePolicies = await db
    .select({
      id: stackBackupPolicies.id,
      orgId: stackBackupPolicies.orgId,
      stackId: stackBackupPolicies.stackId,
      stackName: stacks.name,
      intervalHours: stackBackupPolicies.intervalHours,
      retentionCount: stackBackupPolicies.retentionCount,
    })
    .from(stackBackupPolicies)
    .innerJoin(stacks, eq(stacks.id, stackBackupPolicies.stackId))
    .where(and(
      eq(stackBackupPolicies.enabled, true),
      lte(stackBackupPolicies.nextRunAt, now),
      isNull(stacks.deletedAt),
    ))
    .limit(MAX_POLICIES_PER_TICK)

  for (const policy of duePolicies) {
    const lockKey = REDIS_KEYS.stackBackupPolicyLock(policy.id)
    const claimed = await redis.set(lockKey, '1', 'NX', 'EX', POLICY_LOCK_TTL_SECONDS).catch(() => null)
    if (claimed !== 'OK') continue

    try {
      const backup = await createStackBackup(policy.orgId, policy.stackId, { retentionCount: policy.retentionCount })
      await db
        .update(stackBackupPolicies)
        .set({
          lastRunAt: now,
          nextRunAt: calculateNextStackBackupRun(now, policy.intervalHours),
          lastStatus: 'success',
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(stackBackupPolicies.id, policy.id))
      log?.info({ stackId: policy.stackId, backupId: backup.id }, 'Scheduled stack backup completed')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(stackBackupPolicies)
        .set({
          lastRunAt: now,
          nextRunAt: calculateNextStackBackupRun(now, policy.intervalHours),
          lastStatus: 'failed',
          lastError: message,
          updatedAt: new Date(),
        })
        .where(eq(stackBackupPolicies.id, policy.id))

      await notifyStackBackupFailed({
        orgId: policy.orgId,
        stackId: policy.stackId,
        stackName: policy.stackName,
        errorMessage: message,
      }).catch(notificationError => {
        log?.warn({ err: notificationError, stackId: policy.stackId }, 'Failed to create stack backup failure notification')
      })
      log?.warn({ err: error, stackId: policy.stackId }, 'Scheduled stack backup failed')
    }
  }

  return { processed: duePolicies.length }
}

export function startStackBackupScheduler(log?: Pick<FastifyBaseLogger, 'warn' | 'info'>) {
  const run = () => {
    runDueStackBackups(new Date(), log).catch(error => {
      log?.warn({ err: error }, 'Stack backup scheduler tick failed')
    })
  }

  const initialTimer = setTimeout(run, 15_000)
  const interval = setInterval(run, SCHEDULER_INTERVAL_MS)

  return () => {
    clearTimeout(initialTimer)
    clearInterval(interval)
  }
}
