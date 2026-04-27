import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { addOnBindings, addOns, serverAddOnInstallations } from '../../db/schema.js'
import { NotFoundError } from '../../lib/errors.js'
import type { OwnerType } from './addon-shared.js'

export async function getAddonAuditContext(orgId: string, addonId: string) {
  const [addon] = await db
    .select({
      addOnId: addOns.id,
      name: addOns.name,
      slug: addOns.slug,
    })
    .from(addOns)
    .where(eq(addOns.id, addonId))
    .limit(1)

  if (!addon) throw new NotFoundError('Add-on not found')

  return {
    ...addon,
    orgId,
  }
}

export async function getInstallationAddonAuditContext(orgId: string, installationId: string) {
  const [row] = await db
    .select({
      installationId: serverAddOnInstallations.id,
      serverId: serverAddOnInstallations.serverId,
      addOnId: addOns.id,
      name: addOns.name,
      slug: addOns.slug,
    })
    .from(serverAddOnInstallations)
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .where(and(
      eq(serverAddOnInstallations.id, installationId),
      eq(serverAddOnInstallations.orgId, orgId),
      isNull(serverAddOnInstallations.deletedAt),
    ))
    .limit(1)

  if (!row) throw new NotFoundError('Server add-on installation not found')
  return row
}

export async function getAddonBindingAuditContext(
  orgId: string,
  ownerType: OwnerType,
  ownerId: string,
  bindingId: string,
) {
  const [row] = await db
    .select({
      bindingId: addOnBindings.id,
      installationId: serverAddOnInstallations.id,
      serverId: serverAddOnInstallations.serverId,
      addOnId: addOns.id,
      name: addOns.name,
      slug: addOns.slug,
    })
    .from(addOnBindings)
    .innerJoin(serverAddOnInstallations, eq(addOnBindings.serverAddOnInstallationId, serverAddOnInstallations.id))
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .where(and(
      eq(addOnBindings.id, bindingId),
      eq(addOnBindings.orgId, orgId),
      eq(addOnBindings.ownerType, ownerType),
      eq(addOnBindings.ownerId, ownerId),
      isNull(addOnBindings.deletedAt),
      isNull(serverAddOnInstallations.deletedAt),
    ))
    .limit(1)

  if (!row) throw new NotFoundError('Add-on binding not found')
  return row
}
