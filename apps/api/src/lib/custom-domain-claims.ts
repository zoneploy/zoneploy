import { and, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customPublicEndpoints } from '../db/schema.js'

type DomainOwner =
  | { kind: 'container'; id: string }
  | { kind: 'stack'; id: string }

export async function findVerifiedCustomDomainConflict(
  customDomain: string,
  current?: { kind: 'container' | 'stack'; endpointId: string },
): Promise<DomainOwner | null> {
  const [containerConflict, stackConflict] = await Promise.all([
    db
      .select({ id: customPublicEndpoints.ownerId })
      .from(customPublicEndpoints)
      .where(and(
        eq(customPublicEndpoints.ownerType, 'container'),
        eq(customPublicEndpoints.hostname, customDomain),
        eq(customPublicEndpoints.verified, true),
        isNull(customPublicEndpoints.deletedAt),
        ...(current?.kind === 'container'
          ? [ne(customPublicEndpoints.id, current.endpointId)]
          : []),
      ))
      .limit(1),
    db
      .select({ id: customPublicEndpoints.ownerId })
      .from(customPublicEndpoints)
      .where(and(
        eq(customPublicEndpoints.ownerType, 'stack'),
        eq(customPublicEndpoints.hostname, customDomain),
        eq(customPublicEndpoints.verified, true),
        isNull(customPublicEndpoints.deletedAt),
        ...(current?.kind === 'stack'
          ? [ne(customPublicEndpoints.id, current.endpointId)]
          : []),
      ))
      .limit(1),
  ])

  if (containerConflict?.[0]?.id) {
    return { kind: 'container', id: containerConflict[0].id }
  }

  if (stackConflict?.[0]?.id) {
    return { kind: 'stack', id: stackConflict[0].id }
  }

  return null
}
