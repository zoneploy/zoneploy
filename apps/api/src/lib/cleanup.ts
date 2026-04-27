import { eq, and, desc, notInArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { containerDeployments, containers } from '../db/schema.js'

/**
 * For each container, keeps only the latest `keepLast` deployments.
 * Elimina el resto.
 *
 * Called when each new deployment is created and also as a periodic job.
 */
export async function pruneDeploymentHistory(
  containerId: string,
  keepLast: number = 20,
): Promise<number> {
  const recent = await db
    .select({ id: containerDeployments.id })
    .from(containerDeployments)
    .where(eq(containerDeployments.containerId, containerId))
    .orderBy(desc(containerDeployments.createdAt))
    .limit(keepLast)

  if (recent.length < keepLast) return 0

  const keepIds = recent.map(d => d.id)

  const result = await db
    .delete(containerDeployments)
    .where(
      and(
        eq(containerDeployments.containerId, containerId),
        notInArray(containerDeployments.id, keepIds),
      ),
    )

  const deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0
  if (deleted > 0) {
    console.log(`[cleanup] Container ${containerId.slice(0, 8)}: ${deleted} deployments antiguos eliminados`)
  }
  return deleted
}

/**
 * Global deployment history cleanup for all containers.
 * Runs as a periodic job to cover containers with no recent activity.
 */
export async function cleanupAllDeploymentHistory(keepLast: number = 20): Promise<number> {
  const allContainers = await db
    .select({ id: containers.id })
    .from(containers)

  let total = 0
  for (const container of allContainers) {
    total += await pruneDeploymentHistory(container.id, keepLast)
  }
  return total
}
