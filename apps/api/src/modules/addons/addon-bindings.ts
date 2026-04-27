import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { addOnBindings, addOns, serverAddOnInstallations } from '../../db/schema.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import {
  getInstallationWithAddon,
  getOwnerContext,
  normalizeAddonRequirements,
  normalizeBindingScopes,
  type OwnerType,
} from './addon-shared.js'

export function buildAddonBindingPlan(input: {
  ownerType: OwnerType
  ownerServerId: string
  installationServerId: string
  installationStatus: string
  bindingScopes: string[]
  existingStatus?: string | null
}) {
  if (input.installationServerId !== input.ownerServerId) {
    throw new ValidationError('The selected add-on is installed on a different server')
  }
  if (input.installationStatus !== 'active') {
    throw new ValidationError('The selected add-on is not active on this server')
  }
  if (!input.bindingScopes.includes(input.ownerType)) {
    throw new ValidationError(`This add-on cannot be bound to a ${input.ownerType}`)
  }
  if (input.existingStatus === 'active') {
    throw new ConflictError('This add-on is already bound to the selected deployment')
  }

  return {
    mode: input.existingStatus ? 'reactivate' as const : 'create' as const,
  }
}

export async function getAvailableBindingsForOwner(orgId: string, ownerType: OwnerType, ownerId: string) {
  const owner = await getOwnerContext(orgId, ownerType, ownerId)

  const rows = await db
    .select({
      id: serverAddOnInstallations.id,
      serverId: serverAddOnInstallations.serverId,
      addOnId: serverAddOnInstallations.addOnId,
      status: serverAddOnInstallations.status,
      version: serverAddOnInstallations.version,
      config: serverAddOnInstallations.config,
      capabilities: serverAddOnInstallations.capabilities,
      health: serverAddOnInstallations.health,
      createdAt: serverAddOnInstallations.createdAt,
      updatedAt: serverAddOnInstallations.updatedAt,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
    })
    .from(serverAddOnInstallations)
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .where(
      and(
        eq(serverAddOnInstallations.orgId, orgId),
        eq(serverAddOnInstallations.serverId, owner.serverId),
        eq(serverAddOnInstallations.status, 'active'),
        isNull(serverAddOnInstallations.deletedAt),
      ),
    )
    .orderBy(addOns.category, addOns.name)

  return rows
    .map(row => ({
      ...row,
      bindingScopes: normalizeBindingScopes(row.bindingScopes),
      requirements: normalizeAddonRequirements(row.requirements),
    }))
    .filter(row => row.bindingScopes.includes(ownerType))
}

export async function getOwnerAddonBindings(orgId: string, ownerType: OwnerType, ownerId: string) {
  await getOwnerContext(orgId, ownerType, ownerId)

  const rows = await db
    .select({
      id: addOnBindings.id,
      orgId: addOnBindings.orgId,
      serverAddOnInstallationId: addOnBindings.serverAddOnInstallationId,
      ownerType: addOnBindings.ownerType,
      ownerId: addOnBindings.ownerId,
      status: addOnBindings.status,
      config: addOnBindings.config,
      createdAt: addOnBindings.createdAt,
      updatedAt: addOnBindings.updatedAt,
      installationStatus: serverAddOnInstallations.status,
      serverId: serverAddOnInstallations.serverId,
      addOnId: serverAddOnInstallations.addOnId,
      version: serverAddOnInstallations.version,
      installationConfig: serverAddOnInstallations.config,
      installationCapabilities: serverAddOnInstallations.capabilities,
      installationHealth: serverAddOnInstallations.health,
      name: addOns.name,
      slug: addOns.slug,
      description: addOns.description,
      category: addOns.category,
      controlPlane: addOns.controlPlane,
      installationScope: addOns.installationScope,
      bindingScopes: addOns.bindingScopes,
      requirements: addOns.requirements,
      managedComponents: addOns.managedComponents,
      uiMetadata: addOns.uiMetadata,
    })
    .from(addOnBindings)
    .innerJoin(
      serverAddOnInstallations,
      eq(addOnBindings.serverAddOnInstallationId, serverAddOnInstallations.id),
    )
    .innerJoin(addOns, eq(serverAddOnInstallations.addOnId, addOns.id))
    .where(
      and(
        eq(addOnBindings.orgId, orgId),
        eq(addOnBindings.ownerType, ownerType),
        eq(addOnBindings.ownerId, ownerId),
        isNull(addOnBindings.deletedAt),
        isNull(serverAddOnInstallations.deletedAt),
      ),
    )
    .orderBy(addOns.category, addOns.name)

  return rows.map(row => ({
    id: row.id,
    orgId: row.orgId,
    serverAddOnInstallationId: row.serverAddOnInstallationId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    status: row.status,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    installation: {
      id: row.serverAddOnInstallationId,
      serverId: row.serverId,
      orgId,
      addOnId: row.addOnId,
      status: row.installationStatus,
      version: row.version,
      config: row.installationConfig,
      capabilities: row.installationCapabilities,
      health: row.installationHealth,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      addOn: {
        id: row.addOnId,
        name: row.name,
        slug: row.slug,
        description: row.description,
        category: row.category,
        controlPlane: row.controlPlane,
        installationScope: row.installationScope,
        bindingScopes: normalizeBindingScopes(row.bindingScopes),
        requirements: normalizeAddonRequirements(row.requirements),
        managedComponents: row.managedComponents,
        uiMetadata: row.uiMetadata,
        capabilities: row.installationCapabilities,
        isActive: true,
        createdAt: row.createdAt,
      },
    },
  }))
}

export async function bindAddonToOwner(
  orgId: string,
  ownerType: OwnerType,
  ownerId: string,
  installationId: string,
  config: Record<string, unknown> = {},
) {
  const owner = await getOwnerContext(orgId, ownerType, ownerId)
  const installation = await getInstallationWithAddon(orgId, installationId)

  const bindingScopes = normalizeBindingScopes(installation.bindingScopes)

  const [existing] = await db
    .select({ id: addOnBindings.id, status: addOnBindings.status })
    .from(addOnBindings)
    .where(
      and(
        eq(addOnBindings.serverAddOnInstallationId, installationId),
        eq(addOnBindings.ownerType, ownerType),
        eq(addOnBindings.ownerId, ownerId),
        isNull(addOnBindings.deletedAt),
      ),
    )
    .limit(1)

  const bindingPlan = buildAddonBindingPlan({
    ownerType,
    ownerServerId: owner.serverId,
    installationServerId: installation.serverId,
    installationStatus: installation.status,
    bindingScopes,
    existingStatus: existing?.status ?? null,
  })

  if (bindingPlan.mode === 'reactivate' && existing) {
    const [reactivated] = await db
      .update(addOnBindings)
      .set({
        status: 'active',
        config,
        deletedAt: null,
        deletedByUserId: null,
        deleteReason: null,
        updatedAt: new Date(),
      })
      .where(eq(addOnBindings.id, existing.id))
      .returning()

    if (!reactivated) throw new NotFoundError('Add-on binding not found')

    return reactivated
  }

  const [binding] = await db
    .insert(addOnBindings)
    .values({
      orgId,
      serverAddOnInstallationId: installationId,
      ownerType,
      ownerId,
      status: 'active',
      config,
    })
    .returning()

  if (!binding) throw new ValidationError('The add-on binding could not be created')

  return binding
}

export async function configureAddonBinding(
  orgId: string,
  ownerType: OwnerType,
  ownerId: string,
  bindingId: string,
  config: Record<string, unknown>,
) {
  await getOwnerContext(orgId, ownerType, ownerId)

  const [binding] = await db
    .select({ id: addOnBindings.id })
    .from(addOnBindings)
    .where(
      and(
        eq(addOnBindings.id, bindingId),
        eq(addOnBindings.orgId, orgId),
        eq(addOnBindings.ownerType, ownerType),
        eq(addOnBindings.ownerId, ownerId),
        isNull(addOnBindings.deletedAt),
      ),
    )
    .limit(1)

  if (!binding) throw new NotFoundError('Add-on binding not found')

  const [updated] = await db
    .update(addOnBindings)
    .set({ config, updatedAt: new Date() })
    .where(eq(addOnBindings.id, binding.id))
    .returning()

  if (!updated) throw new NotFoundError('Add-on binding not found')

  return updated
}

export async function unbindAddonFromOwner(
  orgId: string,
  ownerType: OwnerType,
  ownerId: string,
  bindingId: string,
) {
  await getOwnerContext(orgId, ownerType, ownerId)

  const [binding] = await db
    .select({ id: addOnBindings.id })
    .from(addOnBindings)
    .where(
      and(
        eq(addOnBindings.id, bindingId),
        eq(addOnBindings.orgId, orgId),
        eq(addOnBindings.ownerType, ownerType),
        eq(addOnBindings.ownerId, ownerId),
        isNull(addOnBindings.deletedAt),
      ),
    )
    .limit(1)

  if (!binding) throw new NotFoundError('Add-on binding not found')

  await db
    .update(addOnBindings)
    .set({
      status: 'disabled',
      deletedAt: new Date(),
      deleteReason: 'binding_unbound',
      updatedAt: new Date(),
    })
    .where(eq(addOnBindings.id, binding.id))
}
