import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customPublicEndpoints } from '../db/schema.js'

export type PublicEndpointOwnerType = 'container' | 'stack'

type CustomEndpointRow = typeof customPublicEndpoints.$inferSelect

export async function listCustomEndpoints(ownerType: PublicEndpointOwnerType, ownerId: string) {
  return db
    .select()
    .from(customPublicEndpoints)
    .where(and(
      eq(customPublicEndpoints.ownerType, ownerType),
      eq(customPublicEndpoints.ownerId, ownerId),
      isNull(customPublicEndpoints.deletedAt),
    ))
    .orderBy(desc(customPublicEndpoints.isPrimary), asc(customPublicEndpoints.createdAt))
}

export async function clearPrimaryPublicEndpoints(ownerType: PublicEndpointOwnerType, ownerId: string) {
  await db
    .update(customPublicEndpoints)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(and(
      eq(customPublicEndpoints.ownerType, ownerType),
      eq(customPublicEndpoints.ownerId, ownerId),
      isNull(customPublicEndpoints.deletedAt),
    ))
}

export async function promoteNextPrimaryPublicEndpoint(ownerType: PublicEndpointOwnerType, ownerId: string) {
  const customRows = await listCustomEndpoints(ownerType, ownerId)
  const candidate = customRows.find(row => row.verified) ?? customRows[0] ?? null

  if (!candidate) return null

  await db
    .update(customPublicEndpoints)
    .set({ isPrimary: true, updatedAt: new Date() })
    .where(and(eq(customPublicEndpoints.id, candidate.id), isNull(customPublicEndpoints.deletedAt)))

  return { kind: 'custom' as const, id: candidate.id }
}

export function getPreferredPublicHost(customRows: CustomEndpointRow[]) {
  const primaryVerifiedCustom = customRows.find(row => row.isPrimary && row.verified)
  if (primaryVerifiedCustom) {
    return {
      hostname: primaryVerifiedCustom.hostname,
      kind: 'custom' as const,
      verified: true,
    }
  }

  const anyVerifiedCustom = customRows.find(row => row.verified)
  if (anyVerifiedCustom) {
    return {
      hostname: anyVerifiedCustom.hostname,
      kind: 'custom' as const,
      verified: true,
    }
  }

  const primaryCustom = customRows.find(row => row.isPrimary)
  if (primaryCustom) {
    return {
      hostname: primaryCustom.hostname,
      kind: 'custom' as const,
      verified: false,
    }
  }

  const firstCustom = customRows[0]
  if (firstCustom) {
    return {
      hostname: firstCustom.hostname,
      kind: 'custom' as const,
      verified: false,
    }
  }

  return null
}
