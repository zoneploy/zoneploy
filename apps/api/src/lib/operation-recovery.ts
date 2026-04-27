import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import { db } from '../db/client.js'
import { containerDeployments, containers, servers, stackDeployments, stacks } from '../db/schema.js'

const STALE_OPERATION_MS = 30 * 60 * 1000
const RECOVERY_INTERVAL_MS = 5 * 60 * 1000
const RECOVERY_MESSAGE = 'Operation recovered as failed after Platform restart or timeout.'

export interface OperationRecoverySummary {
  servers: number
  containers: number
  containerDeployments: number
  stacks: number
  stackDeployments: number
}

export function isStaleOperation(updatedAt: Date | string, now = new Date(), staleMs = STALE_OPERATION_MS) {
  const updatedTime = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime()
  return Number.isFinite(updatedTime) && updatedTime < now.getTime() - staleMs
}

function emptySummary(): OperationRecoverySummary {
  return {
    servers: 0,
    containers: 0,
    containerDeployments: 0,
    stacks: 0,
    stackDeployments: 0,
  }
}

function hasRecovered(summary: OperationRecoverySummary) {
  return Object.values(summary).some(count => count > 0)
}

export async function recoverStaleOperations(
  now = new Date(),
  staleMs = STALE_OPERATION_MS,
): Promise<OperationRecoverySummary> {
  const cutoff = new Date(now.getTime() - staleMs)
  const summary = emptySummary()

  await db.transaction(async tx => {
    const recoveredServers = await tx
      .update(servers)
      .set({ status: 'error', updatedAt: now })
      .where(
        and(
          isNull(servers.deletedAt),
          inArray(servers.status, ['provisioning', 'disconnecting', 'updating']),
          lt(servers.updatedAt, cutoff),
        ),
      )
      .returning({ id: servers.id })

    const recoveredContainers = await tx
      .update(containers)
      .set({ status: 'error', errorReason: RECOVERY_MESSAGE, updatedAt: now })
      .where(
        and(
          isNull(containers.deletedAt),
          eq(containers.status, 'deploying'),
          lt(containers.updatedAt, cutoff),
        ),
      )
      .returning({ id: containers.id })

    const recoveredContainerDeployments = await tx
      .update(containerDeployments)
      .set({ status: 'failed', errorMessage: RECOVERY_MESSAGE, finishedAt: now })
      .where(
        and(
          inArray(containerDeployments.status, ['pending', 'running']),
          lt(containerDeployments.startedAt, cutoff),
        ),
      )
      .returning({ id: containerDeployments.id })

    const recoveredStacks = await tx
      .update(stacks)
      .set({ status: 'error', errorReason: RECOVERY_MESSAGE, updatedAt: now })
      .where(
        and(
          isNull(stacks.deletedAt),
          eq(stacks.status, 'deploying'),
          lt(stacks.updatedAt, cutoff),
        ),
      )
      .returning({ id: stacks.id })

    const recoveredStackDeployments = await tx
      .update(stackDeployments)
      .set({ status: 'failed', errorMessage: RECOVERY_MESSAGE, finishedAt: now })
      .where(
        and(
          inArray(stackDeployments.status, ['pending', 'running']),
          lt(stackDeployments.startedAt, cutoff),
        ),
      )
      .returning({ id: stackDeployments.id })

    summary.servers = recoveredServers.length
    summary.containers = recoveredContainers.length
    summary.containerDeployments = recoveredContainerDeployments.length
    summary.stacks = recoveredStacks.length
    summary.stackDeployments = recoveredStackDeployments.length
  })

  return summary
}

export function startOperationRecovery(logger?: FastifyBaseLogger) {
  const run = () => {
    recoverStaleOperations()
      .then(summary => {
        if (hasRecovered(summary)) {
          logger?.warn({ summary }, 'Recovered stale operations')
        }
      })
      .catch(error => logger?.warn({ err: error }, 'Error recovering stale operations'))
  }

  setTimeout(run, 10_000)
  return setInterval(run, RECOVERY_INTERVAL_MS)
}
